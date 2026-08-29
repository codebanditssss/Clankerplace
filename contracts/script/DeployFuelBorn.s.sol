// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FuelBorn } from "../src/FuelBorn.sol";

interface VmDeployment {
    function envAddress(string calldata name) external view returns (address value);
    function envUint(string calldata name) external view returns (uint256 value);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployFuelBorn {
    VmDeployment private constant vm =
        VmDeployment(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (FuelBorn deployed) {
        address treasury = vm.envAddress("FUELBORN_TREASURY_ADDRESS");
        address relayer = vm.envAddress("FUELBORN_RELAYER_ADDRESS");
        uint256 minForgeDeposit = vm.envUint("FUELBORN_MIN_FORGE_DEPOSIT_WEI");

        vm.startBroadcast();
        deployed = deploy(treasury, relayer, minForgeDeposit);
        vm.stopBroadcast();
    }

    function deploy(address treasury, address relayer, uint256 minForgeDeposit)
        public
        returns (FuelBorn deployed)
    {
        deployed = new FuelBorn(treasury, relayer, minForgeDeposit);
    }
}
