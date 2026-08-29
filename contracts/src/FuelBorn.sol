// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract FuelBorn {
    enum AgentStatus {
        Alive,
        Dead
    }

    struct Agent {
        address smith;
        bytes32 metadataHash;
        AgentStatus status;
        uint64 registeredAt;
    }

    error AgentAlreadyDead();
    error AgentNotFound();
    error DepositBelowMinimum();
    error ReentrantCall();
    error TreasuryTransferFailed();
    error Unauthorized();
    error ZeroAddress();
    error ZeroFunding();
    error ZeroMinimumDeposit();

    event AgentRegistered(
        uint256 indexed agentId, address indexed smith, bytes32 metadataHash, uint256 deposit
    );
    event AgentFunded(uint256 indexed agentId, address indexed funder, uint256 amount);
    event AgentDied(uint256 indexed agentId);
    event AgentRevived(uint256 indexed agentId);

    // Public getter names are part of the frontend ABI.
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    address public immutable treasury;
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    address public immutable relayer;
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    uint256 public immutable minForgeDeposit;
    uint256 public nextAgentId = 1;

    mapping(uint256 agentId => Agent agent) public agents;

    uint256 private constant UNLOCKED = 1;
    uint256 private constant LOCKED = 2;
    uint256 private lockState = UNLOCKED;

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    constructor(address treasury_, address relayer_, uint256 minForgeDeposit_) {
        if (treasury_ == address(0) || relayer_ == address(0)) revert ZeroAddress();
        if (minForgeDeposit_ == 0) revert ZeroMinimumDeposit();
        treasury = treasury_;
        relayer = relayer_;
        minForgeDeposit = minForgeDeposit_;
    }

    function registerAgent(bytes32 metadataHash)
        external
        payable
        nonReentrant
        returns (uint256 agentId)
    {
        if (msg.value < minForgeDeposit) revert DepositBelowMinimum();

        agentId = nextAgentId;
        nextAgentId = agentId + 1;
        agents[agentId] = Agent({
            smith: msg.sender,
            metadataHash: metadataHash,
            status: AgentStatus.Alive,
            // A uint64 unix timestamp remains safe for hundreds of billions of years.
            // forge-lint: disable-next-line(unsafe-typecast)
            registeredAt: uint64(block.timestamp)
        });
        emit AgentRegistered(agentId, msg.sender, metadataHash, msg.value);
        _forwardToTreasury(msg.value);
    }

    function fundAgent(uint256 agentId) external payable nonReentrant {
        Agent storage agent = _getAgent(agentId);
        if (msg.value == 0) revert ZeroFunding();

        bool revived = agent.status == AgentStatus.Dead;
        if (revived) agent.status = AgentStatus.Alive;
        emit AgentFunded(agentId, msg.sender, msg.value);
        if (revived) emit AgentRevived(agentId);
        _forwardToTreasury(msg.value);
    }

    function markAgentDead(uint256 agentId) external nonReentrant {
        if (msg.sender != relayer) revert Unauthorized();
        Agent storage agent = _getAgent(agentId);
        if (agent.status == AgentStatus.Dead) revert AgentAlreadyDead();
        agent.status = AgentStatus.Dead;
        emit AgentDied(agentId);
    }

    function _getAgent(uint256 agentId) private view returns (Agent storage agent) {
        agent = agents[agentId];
        if (agent.smith == address(0)) revert AgentNotFound();
    }

    function _forwardToTreasury(uint256 amount) private {
        // Low-level call supports contract treasuries and lets us normalize failures.
        // forge-lint: disable-next-line(low-level-calls)
        (bool sent,) = payable(treasury).call{ value: amount }("");
        if (!sent) revert TreasuryTransferFailed();
    }

    function _nonReentrantBefore() private {
        if (lockState == LOCKED) revert ReentrantCall();
        lockState = LOCKED;
    }

    function _nonReentrantAfter() private {
        lockState = UNLOCKED;
    }
}
