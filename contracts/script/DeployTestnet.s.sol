// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { OpenBellReceivables } from "../src/OpenBellReceivables.sol";

/// @notice Deploys OpenBell against canonical Paxos test USDG on X Layer testnet.
contract DeployOpenBellTestnet is Script {
    uint256 internal constant XLAYER_TESTNET_CHAIN_ID = 1952;
    address internal constant TESTNET_USDG = 0xF0863D7A29a55d0c4263c11bFac754312ff078DF;

    function run() external returns (OpenBellReceivables openBell) {
        require(block.chainid == XLAYER_TESTNET_CHAIN_ID, "wrong chain");

        address owner = vm.envAddress("OPENBELL_OWNER");
        address underwriter = vm.envAddress("OPENBELL_UNDERWRITER");

        vm.startBroadcast();
        openBell = new OpenBellReceivables({
            settlementToken_: TESTNET_USDG,
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
