// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FuelBorn } from "../src/FuelBorn.sol";

interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function deal(address account, uint256 newBalance) external;
    function expectRevert(bytes4 revertData) external;
    function getRecordedLogs() external returns (Log[] memory logs);
    function prank(address sender) external;
    function recordLogs() external;
}

contract RejectingTreasury {
    receive() external payable {
        revert("no deposits");
    }
}

contract ReenteringTreasury {
    FuelBorn private target;
    uint256 private agentId;
    bool private armed;
    bool public reentrySucceeded;

    function arm(FuelBorn target_, uint256 agentId_) external {
        target = target_;
        agentId = agentId_;
        armed = true;
    }

    receive() external payable {
        if (!armed) return;
        armed = false;
        (reentrySucceeded,) = address(target).call{ value: msg.value }(
            abi.encodeCall(FuelBorn.fundAgent, (agentId))
        );
    }
}

contract FuelBornTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant TREASURY = address(0xA11CE);
    address private constant RELAYER = address(0xB0B);
    address private constant SMITH = address(0xCAFE);
    address private constant SUPPORTER = address(0xD00D);
    uint256 private constant MIN_DEPOSIT = 0.1 ether;
    bytes32 private constant METADATA_HASH = keccak256("clanker metadata");

    FuelBorn private fuelBorn;

    function setUp() public {
        fuelBorn = new FuelBorn(TREASURY, RELAYER, MIN_DEPOSIT);
        vm.deal(SMITH, 10 ether);
        vm.deal(SUPPORTER, 10 ether);
    }

    function testRegisterAgentForwardsDepositAndStoresIdentity() public {
        vm.prank(SMITH);
        uint256 agentId = fuelBorn.registerAgent{ value: MIN_DEPOSIT }(METADATA_HASH);

        (address smith, bytes32 metadataHash, FuelBorn.AgentStatus status, uint64 registeredAt) =
            fuelBorn.agents(agentId);
        assertEq(agentId, 1);
        assertEq(fuelBorn.nextAgentId(), 2);
        assertEq(smith, SMITH);
        assertEq(metadataHash, METADATA_HASH);
        assertEq(uint256(status), uint256(FuelBorn.AgentStatus.Alive));
        assertEq(uint256(registeredAt), block.timestamp);
        assertEq(TREASURY.balance, MIN_DEPOSIT);
        assertEq(address(fuelBorn).balance, 0);
    }

    function testRegisterAgentEmitsIndexerReadyBirthEvent() public {
        vm.recordLogs();
        vm.prank(SMITH);
        fuelBorn.registerAgent{ value: MIN_DEPOSIT }(METADATA_HASH);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(logs.length, 1);
        assertEq(logs[0].emitter, address(fuelBorn));
        assertEq(logs[0].topics.length, 3);
        assertEq(logs[0].topics[0], keccak256("AgentRegistered(uint256,address,bytes32,uint256)"));
        assertEq(logs[0].topics[1], bytes32(uint256(1)));
        assertEq(logs[0].topics[2], addressTopic(SMITH));
        assertEq(logs[0].data, abi.encode(METADATA_HASH, MIN_DEPOSIT));
    }

    function testRegisterAgentRejectsDepositBelowSpamGate() public {
        vm.expectRevert(FuelBorn.DepositBelowMinimum.selector);
        vm.prank(SMITH);
        fuelBorn.registerAgent{ value: MIN_DEPOSIT - 1 }(METADATA_HASH);
    }

    function testRegisterAgentRollsBackWhenTreasuryRejectsDeposit() public {
        RejectingTreasury rejectingTreasury = new RejectingTreasury();
        FuelBorn broken = new FuelBorn(address(rejectingTreasury), RELAYER, MIN_DEPOSIT);

        vm.expectRevert(FuelBorn.TreasuryTransferFailed.selector);
        vm.prank(SMITH);
        broken.registerAgent{ value: MIN_DEPOSIT }(METADATA_HASH);

        assertEq(broken.nextAgentId(), 1);
    }

    function testFundAgentForwardsMonAndMatchesBackendEventAbi() public {
        uint256 agentId = registerDefaultAgent();
        uint256 amount = 0.25 ether;
        uint256 beforeBalance = TREASURY.balance;

        vm.recordLogs();
        vm.prank(SUPPORTER);
        fuelBorn.fundAgent{ value: amount }(agentId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(TREASURY.balance, beforeBalance + amount);
        assertEq(address(fuelBorn).balance, 0);
        assertEq(logs.length, 1);
        assertEq(logs[0].topics.length, 3);
        assertEq(logs[0].topics[0], keccak256("AgentFunded(uint256,address,uint256)"));
        assertEq(logs[0].topics[1], bytes32(agentId));
        assertEq(logs[0].topics[2], addressTopic(SUPPORTER));
        assertEq(logs[0].data, abi.encode(amount));
    }

    function testFundAgentRejectsUnknownAgent() public {
        vm.expectRevert(FuelBorn.AgentNotFound.selector);
        vm.prank(SUPPORTER);
        fuelBorn.fundAgent{ value: 1 ether }(999);
    }

    function testFundAgentRejectsZeroMon() public {
        uint256 agentId = registerDefaultAgent();

        vm.expectRevert(FuelBorn.ZeroFunding.selector);
        vm.prank(SUPPORTER);
        fuelBorn.fundAgent(agentId);
    }

    function testOnePaymentCannotReenterAndCreateTwoFundingEvents() public {
        ReenteringTreasury reenteringTreasury = new ReenteringTreasury();
        FuelBorn guarded = new FuelBorn(address(reenteringTreasury), RELAYER, MIN_DEPOSIT);
        vm.prank(SMITH);
        uint256 agentId = guarded.registerAgent{ value: MIN_DEPOSIT }(METADATA_HASH);
        reenteringTreasury.arm(guarded, agentId);

        vm.recordLogs();
        vm.prank(SUPPORTER);
        guarded.fundAgent{ value: 1 ether }(agentId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertFalse(reenteringTreasury.reentrySucceeded());
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[0], keccak256("AgentFunded(uint256,address,uint256)"));
        assertEq(address(reenteringTreasury).balance, MIN_DEPOSIT + 1 ether);
    }

    function testOnlyRelayerCanMarkAgentDead() public {
        uint256 agentId = registerDefaultAgent();

        vm.expectRevert(FuelBorn.Unauthorized.selector);
        vm.prank(SUPPORTER);
        fuelBorn.markAgentDead(agentId);

        vm.prank(RELAYER);
        fuelBorn.markAgentDead(agentId);
        (,, FuelBorn.AgentStatus status,) = fuelBorn.agents(agentId);
        assertEq(uint256(status), uint256(FuelBorn.AgentStatus.Dead));
    }

    function testMarkAgentDeadEmitsDeathEvent() public {
        uint256 agentId = registerDefaultAgent();

        vm.recordLogs();
        vm.prank(RELAYER);
        fuelBorn.markAgentDead(agentId);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(logs.length, 1);
        assertEq(logs[0].topics[0], keccak256("AgentDied(uint256)"));
        assertEq(logs[0].topics[1], bytes32(agentId));
    }

    function testMarkAgentDeadRejectsDuplicateTransition() public {
        uint256 agentId = registerDefaultAgent();
        vm.prank(RELAYER);
        fuelBorn.markAgentDead(agentId);

        vm.expectRevert(FuelBorn.AgentAlreadyDead.selector);
        vm.prank(RELAYER);
        fuelBorn.markAgentDead(agentId);
    }

    function testFundingDeadAgentRevivesItExactlyOnce() public {
        uint256 agentId = registerDefaultAgent();
        vm.prank(RELAYER);
        fuelBorn.markAgentDead(agentId);

        vm.recordLogs();
        vm.prank(SUPPORTER);
        fuelBorn.fundAgent{ value: 1 ether }(agentId);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        (,, FuelBorn.AgentStatus status,) = fuelBorn.agents(agentId);

        assertEq(uint256(status), uint256(FuelBorn.AgentStatus.Alive));
        assertEq(logs.length, 2);
        assertEq(logs[0].topics[0], keccak256("AgentFunded(uint256,address,uint256)"));
        assertEq(logs[1].topics[0], keccak256("AgentRevived(uint256)"));
        assertEq(logs[1].topics[1], bytes32(agentId));

        vm.recordLogs();
        vm.prank(SUPPORTER);
        fuelBorn.fundAgent{ value: 1 ether }(agentId);
        logs = vm.getRecordedLogs();
        assertEq(logs.length, 1);
        assertEq(logs[0].topics[0], keccak256("AgentFunded(uint256,address,uint256)"));
    }

    function testConstructorRejectsUnsafeConfiguration() public {
        vm.expectRevert(FuelBorn.ZeroAddress.selector);
        new FuelBorn(address(0), RELAYER, MIN_DEPOSIT);

        vm.expectRevert(FuelBorn.ZeroAddress.selector);
        new FuelBorn(TREASURY, address(0), MIN_DEPOSIT);

        vm.expectRevert(FuelBorn.ZeroMinimumDeposit.selector);
        new FuelBorn(TREASURY, RELAYER, 0);
    }

    function registerDefaultAgent() private returns (uint256) {
        vm.prank(SMITH);
        return fuelBorn.registerAgent{ value: MIN_DEPOSIT }(METADATA_HASH);
    }

    function addressTopic(address value) private pure returns (bytes32) {
        return bytes32(uint256(uint160(value)));
    }

    function assertEq(uint256 actual, uint256 expected) private pure {
        require(actual == expected, "uint assertion failed");
    }

    function assertEq(address actual, address expected) private pure {
        require(actual == expected, "address assertion failed");
    }

    function assertEq(bytes32 actual, bytes32 expected) private pure {
        require(actual == expected, "bytes32 assertion failed");
    }

    function assertEq(bytes memory actual, bytes memory expected) private pure {
        require(keccak256(actual) == keccak256(expected), "bytes assertion failed");
    }

    function assertFalse(bool value) private pure {
        require(!value, "bool assertion failed");
    }
}
