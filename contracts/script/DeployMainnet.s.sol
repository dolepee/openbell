// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { OpenBellReceivables } from "../src/OpenBellReceivables.sol";

/// @notice Mainnet deployment script. Broadcasting requires explicit user approval at action time.
contract DeployOpenBellMainnet is Script {
    uint256 internal constant XLAYER_MAINNET_CHAIN_ID = 196;
    address internal constant USDG = 0x4ae46a509F6b1D9056937BA4500cb143933D2dc8;

    function run() external returns (OpenBellReceivables openBell) {
        require(block.chainid == XLAYER_MAINNET_CHAIN_ID, "wrong chain");

        address owner = vm.envAddress("OPENBELL_OWNER");
        address underwriter = vm.envAddress("OPENBELL_UNDERWRITER");

        vm.startBroadcast();
        openBell = new OpenBellReceivables({
            settlementToken_: USDG,
            initialOwner_: owner,
            underwriter_: underwriter,
            maxAdvanceBps_: 8_000,
            maxFeeBps_: 2_000,
            maxRiskAge_: 1 hours,
            maxInvoiceAge_: 7 days,
            maxInvoiceTenor_: 90 days
        });
        vm.stopBroadcast();
    }
}
