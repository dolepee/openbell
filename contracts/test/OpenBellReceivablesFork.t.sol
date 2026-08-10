// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { OpenBellReceivables } from "../src/OpenBellReceivables.sol";

/// @notice Canonical-token compatibility test. All mutations happen on a local X Layer testnet fork.
contract OpenBellReceivablesCanonicalUSDGForkTest is Test {
    address internal constant TESTNET_USDG = 0xF0863D7A29a55d0c4263c11bFac754312ff078DF;

    uint256 internal constant SUPPLIER_PK = 0xA11CE;
    uint256 internal constant PAYER_PK = 0xB0B;
    uint256 internal constant FUNDER_PK = 0xF00D;
    uint256 internal constant UNDERWRITER_PK = 0xC0FFEE;
    uint256 internal constant UNIT = 1e6;

    address internal supplier;
    address internal payer;
    address internal funder;
    address internal underwriter;
    OpenBellReceivables internal openBell;

    function setUp() public {
        string memory rpcUrl = vm.envOr("XLAYER_TESTNET_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpcUrl);

        supplier = vm.addr(SUPPLIER_PK);
        payer = vm.addr(PAYER_PK);
        funder = vm.addr(FUNDER_PK);
        underwriter = vm.addr(UNDERWRITER_PK);

        openBell = new OpenBellReceivables({
            settlementToken_: TESTNET_USDG,
            initialOwner_: address(this),
            underwriter_: underwriter,
            maxAdvanceBps_: 8_000,
            maxFeeBps_: 2_000,
            maxRiskAge_: 1 hours,
            maxInvoiceAge_: 7 days,
            maxInvoiceTenor_: 90 days
        });

        // Test-only state allocation. This never touches the public testnet.
        deal(TESTNET_USDG, funder, 2_000 * UNIT, true);
        deal(TESTNET_USDG, payer, 2_000 * UNIT, true);

        vm.prank(funder);
        IERC20Metadata(TESTNET_USDG).approve(address(openBell), type(uint256).max);
        vm.prank(payer);
        IERC20Metadata(TESTNET_USDG).approve(address(openBell), type(uint256).max);
    }

    function test_CanonicalTestnetUSDGCompletesExactLifecycle() public {
        assertEq(IERC20Metadata(TESTNET_USDG).name(), "Global Dollar");
        assertEq(IERC20Metadata(TESTNET_USDG).symbol(), "USDG");
        assertEq(IERC20Metadata(TESTNET_USDG).decimals(), 6);

        OpenBellReceivables.InvoiceTerms memory terms = OpenBellReceivables.InvoiceTerms({
            invoiceId: keccak256("openbell-canonical-usdg-fork-invoice"),
            documentHash: keccak256("redacted-fixture-document"),
            supplier: supplier,
            payer: payer,
            faceValue: uint128(1_000 * UNIT),
            issuedAt: uint64(block.timestamp - 1 minutes),
            dueDate: uint64(block.timestamp + 30 days),
            nonce: 1
        });

        bytes32 invoiceDigest = openBell.hashInvoice(terms);
        bytes memory supplierSignature = _sign(SUPPLIER_PK, invoiceDigest);
        bytes memory payerSignature = _sign(PAYER_PK, invoiceDigest);

        vm.prank(supplier);
        openBell.registerInvoice(terms, supplierSignature, payerSignature);

        OpenBellReceivables.RiskApproval memory approval = OpenBellReceivables.RiskApproval({
            invoiceId: terms.invoiceId,
            invoiceDigest: invoiceDigest,
            funder: funder,
            advanceAmount: uint128(700 * UNIT),
            repaymentAmount: uint128(735 * UNIT),
            riskTimestamp: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 15 minutes),
            riskReasonsHash: keccak256("strong history; bounded advance"),
            modelHash: keccak256("openbell-risk-v1"),
            nonce: 1
        });
        bytes32 decisionDigest = openBell.hashApproval(approval);
        bytes memory underwriterSignature = _sign(UNDERWRITER_PK, decisionDigest);

        uint256 supplierBefore = IERC20Metadata(TESTNET_USDG).balanceOf(supplier);
        uint256 funderBefore = IERC20Metadata(TESTNET_USDG).balanceOf(funder);

        vm.prank(funder);
        openBell.fund(approval, underwriterSignature);

        assertEq(IERC20Metadata(TESTNET_USDG).balanceOf(supplier) - supplierBefore, 700 * UNIT);
        assertEq(funderBefore - IERC20Metadata(TESTNET_USDG).balanceOf(funder), 700 * UNIT);

        uint256 payerBefore = IERC20Metadata(TESTNET_USDG).balanceOf(payer);
        vm.prank(payer);
        openBell.settle(terms.invoiceId);

        assertEq(payerBefore - IERC20Metadata(TESTNET_USDG).balanceOf(payer), 735 * UNIT);
        assertEq(IERC20Metadata(TESTNET_USDG).balanceOf(funder), funderBefore + 35 * UNIT);

        (OpenBellReceivables.InvoiceStatus status,,,,,,,,,,) = openBell.invoices(terms.invoiceId);
        assertEq(uint8(status), uint8(OpenBellReceivables.InvoiceStatus.SETTLED));
    }

    function _sign(uint256 privateKey, bytes32 digest) private view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
