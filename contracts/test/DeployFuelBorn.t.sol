// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { DeployFuelBorn } from "../script/DeployFuelBorn.s.sol";
import { FuelBorn } from "../src/FuelBorn.sol";

interface ITestVm {
    function setEnv(string calldata name, string calldata value) external;
    function toString(address value) external pure returns (string memory);
    function toString(uint256 value) external pure returns (string memory);
}

contract DeployFuelBornTest {
    ITestVm private constant VM = ITestVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant TREASURY = address(0xA11CE);
    address private constant RELAYER = address(0xB0B);
    uint256 private constant MIN_DEPOSIT = 0.1 ether;

    function testRunReadsEnvironmentAndDeploysTheConfiguredFuelBornContract() public {
        VM.setEnv("FUELBORN_TREASURY_ADDRESS", VM.toString(TREASURY));
        VM.setEnv("FUELBORN_RELAYER_ADDRESS", VM.toString(RELAYER));
        VM.setEnv("FUELBORN_MIN_FORGE_DEPOSIT_WEI", VM.toString(MIN_DEPOSIT));
        DeployFuelBorn script = new DeployFuelBorn();
        FuelBorn deployed = script.run();

        require(deployed.treasury() == TREASURY, "treasury mismatch");
        require(deployed.relayer() == RELAYER, "relayer mismatch");
        require(deployed.minForgeDeposit() == MIN_DEPOSIT, "deposit mismatch");
        require(deployed.nextAgentId() == 1, "unexpected first agent id");
    }
}
