// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { OpenBellReceivables } from "../src/OpenBellReceivables.sol";
import { OpenBellTestUSDG } from "../src/mocks/OpenBellTestUSDG.sol";

/// @notice Deploys the explicitly labelled, no-value OpenBell fixture stack on X Layer testnet.
/// @dev This script has no canonical-USDG mode. Use DeployTestnet.s.sol for that separate path.
///      The deployer may also be the owner or underwriter; only owner/underwriter separation is required.
contract DeployOpenBellFixtureTestnet is Script {
    uint256 internal constant XLAYER_TESTNET_CHAIN_ID = 1952;
    uint16 internal constant MAX_ADVANCE_BPS = 8_000;
    uint16 internal constant MAX_FEE_BPS = 2_000;
    uint64 internal constant MAX_RISK_AGE = 1 hours;
    uint64 internal constant MAX_INVOICE_AGE = 7 days;
    uint64 internal constant MAX_INVOICE_TENOR = 90 days;

    error WrongChain(uint256 actual);
    error ZeroRole();
    error SameOwnerAndUnderwriter();
    error PostDeployAssertionFailed();

    function run() external returns (OpenBellTestUSDG fixtureSettlement, OpenBellReceivables openBell) {
        address deployer = vm.envAddress("OPENBELL_DEPLOYER");
        address owner = vm.envAddress("OPENBELL_OWNER");
        address underwriter = vm.envAddress("OPENBELL_UNDERWRITER");

        return deployFixture(deployer, owner, underwriter);
    }

    /// @dev Public for deterministic offline script tests; it still creates only broadcast intents.
    function deployFixture(address deployer, address owner, address underwriter)
        public
        returns (OpenBellTestUSDG fixtureSettlement, OpenBellReceivables openBell)
    {
        if (block.chainid != XLAYER_TESTNET_CHAIN_ID) revert WrongChain(block.chainid);
        if (deployer == address(0) || owner == address(0) || underwriter == address(0)) {
            revert ZeroRole();
        }
        if (owner == underwriter) revert SameOwnerAndUnderwriter();

        vm.startBroadcast(deployer);
        fixtureSettlement = new OpenBellTestUSDG();
        openBell = new OpenBellReceivables({
            settlementToken_: address(fixtureSettlement),
            initialOwner_: owner,
            underwriter_: underwriter,
            maxAdvanceBps_: MAX_ADVANCE_BPS,
            maxFeeBps_: MAX_FEE_BPS,
            maxRiskAge_: MAX_RISK_AGE,
            maxInvoiceAge_: MAX_INVOICE_AGE,
            maxInvoiceTenor_: MAX_INVOICE_TENOR
        });
        vm.stopBroadcast();

        _assertFixture(fixtureSettlement, openBell, owner, underwriter);
    }

    function _assertFixture(
        OpenBellTestUSDG fixtureSettlement,
        OpenBellReceivables openBell,
        address owner,
        address underwriter
    ) private view {
        if (address(fixtureSettlement).code.length == 0 || address(openBell).code.length == 0) {
            revert PostDeployAssertionFailed();
        }
        if (
            fixtureSettlement.decimals() != 6
                || keccak256(bytes(fixtureSettlement.name()))
                    != keccak256(bytes("OpenBell Test USDG (Fixture)"))
                || keccak256(bytes(fixtureSettlement.symbol())) != keccak256(bytes("tUSDG"))
                || fixtureSettlement.FAUCET_AMOUNT() != 1_000e6 || fixtureSettlement.totalSupply() != 0
        ) revert PostDeployAssertionFailed();
        if (
            address(openBell.settlementToken()) != address(fixtureSettlement) || openBell.owner() != owner
                || openBell.pendingOwner() != address(0) || openBell.underwriter() != underwriter
                || openBell.paused() || openBell.maxAdvanceBps() != MAX_ADVANCE_BPS
                || openBell.maxFeeBps() != MAX_FEE_BPS || openBell.maxRiskAge() != MAX_RISK_AGE
                || openBell.maxInvoiceAge() != MAX_INVOICE_AGE
                || openBell.maxInvoiceTenor() != MAX_INVOICE_TENOR
        ) revert PostDeployAssertionFailed();

        (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 domainChainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        ) = openBell.eip712Domain();
        if (
            fields != 0x0f || keccak256(bytes(name)) != keccak256(bytes("OpenBell Receivables"))
                || keccak256(bytes(version)) != keccak256(bytes("1"))
                || domainChainId != XLAYER_TESTNET_CHAIN_ID || verifyingContract != address(openBell)
                || salt != bytes32(0) || extensions.length != 0
        ) revert PostDeployAssertionFailed();
    }
}
