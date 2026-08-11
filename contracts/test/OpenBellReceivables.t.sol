// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { OpenBellReceivables } from "../src/OpenBellReceivables.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function warp(uint256 newTimestamp) external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes calldata revertData) external;
}

contract TestERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external virtual returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowed - amount);
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal virtual {
        require(to != address(0), "zero recipient");
        uint256 balance = balanceOf[from];
        require(balance >= amount, "balance");
        unchecked {
            balanceOf[from] = balance - amount;
            balanceOf[to] += amount;
        }
        emit Transfer(from, to, amount);
    }
}

contract FeeOnTransferERC20 is TestERC20 {
    uint16 public feeBps;

    constructor() TestERC20("Fee USDG", "fUSDG", 6) { }

    function setFeeBps(uint16 newFeeBps) external {
        require(newFeeBps <= 1_000, "fee too high");
        feeBps = newFeeBps;
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        require(to != address(0), "zero recipient");
        uint256 balance = balanceOf[from];
        require(balance >= amount, "balance");

        uint256 fee = amount * feeBps / 10_000;
        uint256 received = amount - fee;
        unchecked {
            balanceOf[from] = balance - amount;
            balanceOf[to] += received;
            totalSupply -= fee;
        }
        emit Transfer(from, to, received);
        if (fee != 0) emit Transfer(from, address(0), fee);
    }
}

contract MockERC1271Wallet is IERC1271 {
    bytes4 internal constant INVALID = 0xffffffff;
    mapping(bytes32 digest => mapping(bytes32 signatureHash => bool allowed)) public allowed;

    function allow(bytes32 digest, bytes calldata signature) external {
        allowed[digest][keccak256(signature)] = true;
    }

    function isValidSignature(bytes32 digest, bytes memory signature) external view returns (bytes4) {
        return allowed[digest][keccak256(signature)] ? IERC1271.isValidSignature.selector : INVALID;
    }
}

abstract contract OpenBellTestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant SUPPLIER_PK = 0xA11CE;
    uint256 internal constant PAYER_PK = 0xB0B;
    uint256 internal constant UNDERWRITER_PK = 0xC0FFEE;
    uint256 internal constant NEW_UNDERWRITER_PK = 0xD00D;
    uint256 internal constant OTHER_SUPPLIER_PK = 0xA11CE2;
    uint256 internal constant OTHER_PAYER_PK = 0xB0B2;

    uint16 internal constant MAX_ADVANCE_BPS = 8_000;
    uint16 internal constant MAX_FEE_BPS = 1_000;
    uint64 internal constant MAX_RISK_AGE = 1 days;
    uint64 internal constant MAX_INVOICE_AGE = 7 days;
    uint64 internal constant MAX_INVOICE_TENOR = 90 days;
    uint256 internal constant UNIT = 1e6;
    uint256 internal constant FACE_VALUE = 1_000 * UNIT;

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("OpenBell Receivables");
    bytes32 internal constant VERSION_HASH = keccak256("1");

    TestERC20 internal token;
    OpenBellReceivables internal receivables;

    address internal supplier;
    address internal payer;
    address internal underwriter;
    address internal newUnderwriter;
    address internal otherSupplier;
    address internal otherPayer;
    address internal funder;
    address internal outsider;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        supplier = vm.addr(SUPPLIER_PK);
        payer = vm.addr(PAYER_PK);
        underwriter = vm.addr(UNDERWRITER_PK);
        newUnderwriter = vm.addr(NEW_UNDERWRITER_PK);
        otherSupplier = vm.addr(OTHER_SUPPLIER_PK);
        otherPayer = vm.addr(OTHER_PAYER_PK);
        funder = address(0xF00D);
        outsider = address(0xBAD);

        token = new TestERC20("Test USDG", "tUSDG", 6);
        receivables = _deploy(address(token), underwriter, MAX_ADVANCE_BPS, MAX_FEE_BPS);

        token.mint(funder, 10_000 * UNIT);
        token.mint(payer, 10_000 * UNIT);
        token.mint(otherPayer, 10_000 * UNIT);
        vm.prank(funder);
        token.approve(address(receivables), type(uint256).max);
        vm.prank(payer);
        token.approve(address(receivables), type(uint256).max);
        vm.prank(otherPayer);
        token.approve(address(receivables), type(uint256).max);
    }

    function _deploy(address settlementToken, address underwritingSigner, uint16 advanceBps, uint16 feeBps)
        internal
        returns (OpenBellReceivables instance)
    {
        instance = new OpenBellReceivables(
            settlementToken,
            address(this),
            underwritingSigner,
            advanceBps,
            feeBps,
            MAX_RISK_AGE,
            MAX_INVOICE_AGE,
            MAX_INVOICE_TENOR
        );
    }

    function _terms(bytes32 salt, uint256 nonce)
        internal
        view
        returns (OpenBellReceivables.InvoiceTerms memory terms)
    {
        terms = OpenBellReceivables.InvoiceTerms({
            invoiceId: keccak256(abi.encode("invoice", salt)),
            documentHash: keccak256(abi.encode("document", salt)),
            supplier: supplier,
            payer: payer,
            faceValue: uint128(FACE_VALUE),
            issuedAt: uint64(block.timestamp - 1 hours),
            dueDate: uint64(block.timestamp + 30 days),
            nonce: nonce
        });
    }

    function _approval(OpenBellReceivables.InvoiceTerms memory terms, bytes32 invoiceDigest, uint256 nonce)
        internal
        view
        returns (OpenBellReceivables.RiskApproval memory approval)
    {
        approval = OpenBellReceivables.RiskApproval({
            invoiceId: terms.invoiceId,
            invoiceDigest: invoiceDigest,
            funder: funder,
            advanceAmount: uint128(750 * UNIT),
            repaymentAmount: uint128(795 * UNIT),
            riskTimestamp: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 days),
            riskReasonsHash: keccak256("verified payer and invoice"),
            modelHash: keccak256("openbell-risk-v1"),
            nonce: nonce
        });
    }

    function _rejection(OpenBellReceivables.InvoiceTerms memory terms, bytes32 invoiceDigest, uint256 nonce)
        internal
        view
        returns (OpenBellReceivables.RiskRejection memory rejection)
    {
        rejection = OpenBellReceivables.RiskRejection({
            invoiceId: terms.invoiceId,
            invoiceDigest: invoiceDigest,
            riskTimestamp: uint64(block.timestamp),
            expiresAt: uint64(block.timestamp + 1 days),
            riskReasonsHash: keccak256("invoice evidence inconsistent"),
            modelHash: keccak256("openbell-risk-v1"),
            nonce: nonce
        });
    }

    function _register(OpenBellReceivables.InvoiceTerms memory terms)
        internal
        returns (bytes32 invoiceDigest)
    {
        bytes32 digest = _manualInvoiceDigest(receivables, terms);
        bytes memory supplierSignature = _sign(SUPPLIER_PK, digest);
        bytes memory payerSignature = _sign(PAYER_PK, digest);
        vm.prank(terms.supplier);
        invoiceDigest = receivables.registerInvoice(terms, supplierSignature, payerSignature);
        _assertEq(invoiceDigest, digest, "registered digest");
    }

    function _fund(
        OpenBellReceivables.InvoiceTerms memory terms,
        bytes32 invoiceDigest,
        uint256 decisionNonce
    ) internal returns (OpenBellReceivables.RiskApproval memory approval, bytes32 decisionDigest) {
        approval = _approval(terms, invoiceDigest, decisionNonce);
        bytes32 digest = _manualApprovalDigest(receivables, approval);
        bytes memory signature = _sign(UNDERWRITER_PK, digest);
        vm.prank(funder);
        decisionDigest = receivables.fund(approval, signature);
        _assertEq(decisionDigest, digest, "funding digest");
    }

    function _sign(uint256 privateKey, bytes32 digest) internal returns (bytes memory signature) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        signature = abi.encodePacked(r, s, v);
    }

    function _manualInvoiceDigest(OpenBellReceivables instance, OpenBellReceivables.InvoiceTerms memory terms)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                instance.INVOICE_TYPEHASH(),
                terms.invoiceId,
                terms.documentHash,
                terms.supplier,
                terms.payer,
                terms.faceValue,
                terms.issuedAt,
                terms.dueDate,
                terms.nonce
            )
        );
        return _typedDataDigest(address(instance), structHash);
    }

    function _manualApprovalDigest(
        OpenBellReceivables instance,
        OpenBellReceivables.RiskApproval memory approval
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                instance.APPROVAL_TYPEHASH(),
                approval.invoiceId,
                approval.invoiceDigest,
                approval.funder,
                approval.advanceAmount,
                approval.repaymentAmount,
                approval.riskTimestamp,
                approval.expiresAt,
                approval.riskReasonsHash,
                approval.modelHash,
                approval.nonce
            )
        );
        return _typedDataDigest(address(instance), structHash);
    }

    function _manualRejectionDigest(
        OpenBellReceivables instance,
        OpenBellReceivables.RiskRejection memory rejection
    ) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                instance.REJECTION_TYPEHASH(),
                rejection.invoiceId,
                rejection.invoiceDigest,
                rejection.riskTimestamp,
                rejection.expiresAt,
                rejection.riskReasonsHash,
                rejection.modelHash,
                rejection.nonce
            )
        );
        return _typedDataDigest(address(instance), structHash);
    }

    function _typedDataDigest(address verifyingContract, bytes32 structHash) internal view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, verifyingContract)
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _status(bytes32 invoiceId) internal view returns (OpenBellReceivables.InvoiceStatus status) {
        (status,,,,,,,,,,) = receivables.invoices(invoiceId);
    }

    function _funder(bytes32 invoiceId) internal view returns (address recordedFunder) {
        (,,, recordedFunder,,,,,,,) = receivables.invoices(invoiceId);
    }

    function _decisionDigest(bytes32 invoiceId) internal view returns (bytes32 digest) {
        (,,,,,,,,,, digest) = receivables.invoices(invoiceId);
    }

    function _assertEq(uint256 actual, uint256 expected, string memory reason) internal pure {
        require(actual == expected, reason);
    }

    function _assertEq(address actual, address expected, string memory reason) internal pure {
        require(actual == expected, reason);
    }

    function _assertEq(bytes32 actual, bytes32 expected, string memory reason) internal pure {
        require(actual == expected, reason);
    }

    function _assertEq(bool actual, bool expected, string memory reason) internal pure {
        require(actual == expected, reason);
    }
}

contract OpenBellReceivablesLifecycleTest is OpenBellTestBase {
    function test_RegisterFundSettle_WithIndependentEip712DigestsAndSignatures() public {
        OpenBellReceivables.InvoiceTerms memory terms = _terms("happy", 1);
        bytes32 invoiceDigest = _register(terms);

        _assertEq(
            uint256(_status(terms.invoiceId)),
            uint256(OpenBellReceivables.InvoiceStatus.REGISTERED),
            "registered status"
        );
        _assertEq(receivables.usedInvoiceDigests(invoiceDigest), true, "invoice digest consumed");
        _assertEq(receivables.usedPartyNonces(supplier, terms.nonce), true, "supplier nonce");
        _assertEq(receivables.usedPartyNonces(payer, terms.nonce), true, "payer nonce");

        uint256 supplierBefore = token.balanceOf(supplier);
        (OpenBellReceivables.RiskApproval memory approval, bytes32 decisionDigest) =
            _fund(terms, invoiceDigest, 91);

        _assertEq(
            uint256(_status(terms.invoiceId)),
            uint256(OpenBellReceivables.InvoiceStatus.FUNDED),
            "funded status"
        );
        _assertEq(_funder(terms.invoiceId), funder, "recorded funder");
        _assertEq(_decisionDigest(terms.invoiceId), decisionDigest, "recorded decision");
        _assertEq(token.balanceOf(supplier) - supplierBefore, approval.advanceAmount, "exact advance");
        _assertEq(receivables.usedDecisionNonces(underwriter, approval.nonce), true, "decision nonce");

        uint256 funderBefore = token.balanceOf(funder);
        vm.prank(payer);
        receivables.settle(terms.invoiceId);

        _assertEq(
            uint256(_status(terms.invoiceId)),
            uint256(OpenBellReceivables.InvoiceStatus.SETTLED),
            "settled status"
        );
        _assertEq(token.balanceOf(funder) - funderBefore, approval.repaymentAmount, "exact repayment");
    }

    function test_AttestRejection_UsesUnderwriterEip712SignatureAndConsumesNonce() public {
        OpenBellReceivables.InvoiceTerms memory terms = _terms("rejected", 2);
        bytes32 invoiceDigest = _register(terms);
        OpenBellReceivables.RiskRejection memory rejection = _rejection(terms, invoiceDigest, 92);
        bytes32 digest = _manualRejectionDigest(receivables, rejection);

        vm.prank(supplier);
        bytes32 returnedDigest = receivables.attestRejection(rejection, _sign(UNDERWRITER_PK, digest));

        _assertEq(returnedDigest, digest, "rejection digest");
        _assertEq(_decisionDigest(terms.invoiceId), digest, "stored rejection digest");
        _assertEq(
            uint256(_status(terms.invoiceId)),
            uint256(OpenBellReceivables.InvoiceStatus.REJECTED),
            "rejected status"
        );
        _assertEq(receivables.usedDecisionNonces(underwriter, rejection.nonce), true, "rejection nonce");

        OpenBellReceivables.RiskApproval memory approval = _approval(terms, invoiceDigest, 93);
        bytes memory approvalSignature = _sign(UNDERWRITER_PK, _manualApprovalDigest(receivables, approval));
        vm.expectRevert(
            abi.encodeWithSelector(
                OpenBellReceivables.InvalidStatus.selector,
                OpenBellReceivables.InvoiceStatus.REGISTERED,
                OpenBellReceivables.InvoiceStatus.REJECTED
            )
        );
        vm.prank(funder);
        receivables.fund(approval, approvalSignature);
    }

    function test_CancelUnfunded_IsTerminalAndLeavesSignaturesConsumed() public {
        OpenBellReceivables.InvoiceTerms memory terms = _terms("cancel", 3);
        bytes32 digest = _register(terms);

        vm.prank(supplier);
        receivables.cancelUnfunded(terms.invoiceId);

        _assertEq(
            uint256(_status(terms.invoiceId)),
            uint256(OpenBellReceivables.InvoiceStatus.CANCELLED),
            "cancelled status"
        );
        _assertEq(receivables.usedInvoiceDigests(digest), true, "digest remains consumed");

        vm.expectRevert(
            abi.encodeWithSelector(
                OpenBellReceivables.InvalidStatus.selector,
                OpenBellReceivables.InvoiceStatus.REGISTERED,
                OpenBellReceivables.InvoiceStatus.CANCELLED
            )
        );
        vm.prank(supplier);
        receivables.cancelUnfunded(terms.invoiceId);
    }

    function test_OnlySupplierCanCancelAndFundedInvoiceCannotBeCancelled() public {
        OpenBellReceivables.InvoiceTerms memory terms = _terms("cancel-auth", 4);
        bytes32 digest = _register(terms);

        vm.expectRevert(OpenBellReceivables.Unauthorized.selector);
        vm.prank(outsider);
        receivables.cancelUnfunded(terms.invoiceId);

        _fund(terms, digest, 94);
        vm.expectRevert(
            abi.encodeWithSelector(
                OpenBellReceivables.InvalidStatus.selector,
                OpenBellReceivables.InvoiceStatus.REGISTERED,
                OpenBellReceivables.InvoiceStatus.FUNDED
            )
        );
        vm.prank(supplier);
        receivables.cancelUnfunded(terms.invoiceId);
    }
}

contract OpenBellReceivablesSignatureAndReplayTest is OpenBellTestBase {
    function test_RegisterRequiresSupplierCallerAndBothCorrectSigners() public {
        OpenBellReceivables.InvoiceTerms memory terms = _terms("auth", 10);
        bytes32 digest = _manualInvoiceDigest(receivables, terms);
        bytes memory supplierSignature = _sign(SUPPLIER_PK, digest);
        bytes memory payerSignature = _sign(PAYER_PK, digest);

        vm.expectRevert(OpenBellReceivables.Unauthorized.selector);
        vm.prank(outsider);
        receivables.registerInvoice(terms, supplierSignature, payerSignature);

        vm.expectRevert(abi.encodeWithSelector(OpenBellReceivables.InvalidSignature.selector, terms.supplier));
        vm.prank(supplier);
        receivables.registerInvoice(terms, _sign(OTHER_SUPPLIER_PK, digest), payerSignature);

        vm.expectRevert(abi.encodeWithSelector(OpenBellReceivables.InvalidSignature.selector, terms.payer));
        vm.prank(supplier);
        receivables.registerInvoice(terms, supplierSignature, _sign(OTHER_PAYER_PK, digest));

        _assertEq(receivables.usedPartyNonces(supplier, terms.nonce), false, "failed nonce untouched");
        _assertEq(receivables.usedInvoiceDigests(digest), false, "failed digest untouched");
    }

    function test_DuplicateInvoiceIdRejectedEvenWithChangedDocumentAndNonce() public {
        OpenBellReceivables.InvoiceTerms memory first = _terms("duplicate-id", 11);
        _register(first);

        OpenBellReceivables.InvoiceTerms memory duplicate = first;
        duplicate.documentHash = keccak256("different document");
        duplicate.nonce = 12;
        bytes32 digest = _manualInvoiceDigest(receivables, duplicate);

        vm.expectRevert(OpenBellReceivables.DuplicateInvoice.selector);
        vm.prank(supplier);
        receivables.registerInvoice(duplicate, _sign(SUPPLIER_PK, digest), _sign(PAYER_PK, digest));
    }

    function test_DuplicateDocumentRejectedUnderNewInvoiceIdAndNonce() public {
        OpenBellReceivables.InvoiceTerms memory first = _terms("duplicate-document", 111);
        _register(first);

        OpenBellReceivables.InvoiceTerms memory duplicate = _terms("new-invoice-id", 112);
        duplicate.documentHash = first.documentHash;
        bytes32 digest = _manualInvoiceDigest(receivables, duplicate);

        vm.expectRevert(OpenBellReceivables.DuplicateDocument.selector);
        vm.prank(supplier);
        receivables.registerInvoice(duplicate, _sign(SUPPLIER_PK, digest), _sign(PAYER_PK, digest));

        _assertEq(receivables.usedPartyNonces(supplier, duplicate.nonce), false, "supplier nonce untouched");
        _assertEq(receivables.usedPartyNonces(payer, duplicate.nonce), false, "payer nonce untouched");
    }

    function test_SupplierNonceCannotBeReusedAcrossDifferentInvoices() public {
        OpenBellReceivables.InvoiceTerms memory first = _terms("supplier-nonce-a", 13);
        _register(first);

        OpenBellReceivables.InvoiceTerms memory second = _terms("supplier-nonce-b", 13);
        second.payer = otherPayer;
        bytes32 digest = _manualInvoiceDigest(receivables, second);

        vm.expectRevert(
            abi.encodeWithSelector(OpenBellReceivables.NonceUsed.selector, supplier, second.nonce)
        );
        vm.prank(supplier);
        receivables.registerInvoice(second, _sign(SUPPLIER_PK, digest), _sign(OTHER_PAYER_PK, digest));
    }

    function test_PayerNonceCannotBeReusedWithAnotherSupplier() public {
        OpenBellReceivables.InvoiceTerms memory first = _terms("payer-nonce-a", 14);
        _register(first);

        OpenBellReceivables.InvoiceTerms memory second = _terms("payer-nonce-b", 14);
        second.supplier = otherSupplier;
        bytes32 digest = _manualInvoiceDigest(receivables, second);

        vm.expectRevert(abi.encodeWithSelector(OpenBellReceivables.NonceUsed.selector, payer, second.nonce));
        vm.prank(otherSupplier);
        receivables.registerInvoice(second, _sign(OTHER_SUPPLIER_PK, digest), _sign(PAYER_PK, digest));
    }

    function test_DecisionNonceCannotBeReplayedAcrossInvoices() public {
        OpenBellReceivables.InvoiceTerms memory first = _terms("decision-a", 15);
        bytes32 firstDigest = _register(first);
        _fund(first, firstDigest, 100);

        OpenBellReceivables.InvoiceTerms memory second = _terms("decision-b", 16);
        bytes32 secondDigest = _register(second);
        OpenBellReceivables.RiskApproval memory secondApproval = _approval(second, secondDigest, 100);
        bytes32 approvalDigest = _manualApprovalDigest(receivables, secondApproval);

        vm.expectRevert(abi.encodeWithSelector(OpenBellReceivables.NonceUsed.selector, underwriter, 100));
        vm.prank(funder);
        receivables.fund(secondApproval, _sign(UNDERWRITER_PK, approvalDigest));
    }

    function test_FundingReplayFailsOnTerminalStatusBeforeMovingFunds() public {
        OpenBellReceivables.InvoiceTerms memory terms = _terms("fund-replay", 17);
        bytes32 invoiceDigest = _register(terms);
        (OpenBellReceivables.RiskApproval memory approval,) = _fund(terms, invoiceDigest, 101);
        uint256 supplierBalance = token.balanceOf(supplier);
        bytes memory replaySignature = _sign(UNDERWRITER_PK, _manualApprovalDigest(receivables, approval));

        vm.expectRevert(
            abi.encodeWithSelector(
                OpenBellReceivables.InvalidStatus.selector,
                OpenBellReceivables.InvoiceStatus.REGISTERED,
                OpenBellReceivables.InvoiceStatus.FUNDED
            )
        );
        vm.prank(funder);
        receivables.fund(approval, replaySignature);

        _assertEq(token.balanceOf(supplier), supplierBalance, "replay moves nothing");
    }

    function test_ApprovalIsBoundToFunderAndInvoicePartiesCannotFund() public {
        OpenBellReceivables.InvoiceTerms memory terms = _terms("bound-funder", 18);
        bytes32 invoiceDigest = _register(terms);
        OpenBellReceivables.RiskApproval memory approval = _approval(terms, invoiceDigest, 102);
        bytes memory signature = _sign(UNDERWRITER_PK, _manualApprovalDigest(receivables, approval));

        vm.expectRevert(OpenBellReceivables.Unauthorized.selector);
        vm.prank(outsider);
        receivables.fund(approval, signature);

        OpenBellReceivables.RiskApproval memory supplierApproval = approval;
        supplierApproval.funder = supplier;
        bytes memory supplierSignature =
            _sign(UNDERWRITER_PK, _manualApprovalDigest(receivables, supplierApproval));
        vm.expectRevert(OpenBellReceivables.SameParty.selector);
        vm.prank(supplier);
        receivables.fund(supplierApproval, supplierSignature);

        OpenBellReceivables.RiskApproval memory payerApproval = approval;
        payerApproval.funder = payer;
        bytes memory payerSignature = _sign(UNDERWRITER_PK, _manualApprovalDigest(receivables, payerApproval));
        vm.expectRevert(OpenBellReceivables.SameParty.selector);
        vm.prank(payer);
        receivables.fund(payerApproval, payerSignature);

        OpenBellReceivables.RiskApproval memory zeroFunder = approval;
        zeroFunder.funder = address(0);
        bytes memory zeroFunderSignature =
            _sign(UNDERWRITER_PK, _manualApprovalDigest(receivables, zeroFunder));
        vm.expectRevert(OpenBellReceivables.ZeroAddress.selector);
        vm.prank(funder);
        receivables.fund(zeroFunder, zeroFunderSignature);

        _assertEq(receivables.usedDecisionNonces(underwriter, approval.nonce), false, "nonce untouched");
        _assertEq(uint256(_status(terms.invoiceId)), 1, "invoice remains registered");
    }

    function test_OnlySupplierCanAttestRejectionAndOnlyPayerCanSettle() public {
        OpenBellReceivables.InvoiceTerms memory rejectedTerms = _terms("reject-auth", 19);
        bytes32 rejectedDigest = _register(rejectedTerms);
        OpenBellReceivables.RiskRejection memory rejection = _rejection(rejectedTerms, rejectedDigest, 103);
        bytes memory rejectionSignature =
            _sign(UNDERWRITER_PK, _manualRejectionDigest(receivables, rejection));

        vm.expectRevert(OpenBellReceivables.Unauthorized.selector);
        vm.prank(outsider);
        receivables.attestRejection(rejection, rejectionSignature);

        OpenBellReceivables.InvoiceTerms memory fundedTerms = _terms("settle-auth", 20);
        bytes32 fundedDigest = _register(fundedTerms);
        _fund(fundedTerms, fundedDigest, 104);

        vm.expectRevert(OpenBellReceivables.Unauthorized.selector);
        vm.prank(outsider);
        receivables.settle(fundedTerms.invoiceId);
    }
}

contract OpenBellReceivablesDecisionEnvelopeTest is OpenBellTestBase {
    function test_ApprovalRejectsMismatchedInvoiceDigest() public {
        (OpenBellReceivables.InvoiceTerms memory terms, bytes32 invoiceDigest) = _registered("mismatch", 30);
        OpenBellReceivables.RiskApproval memory approval = _approval(terms, invoiceDigest, 200);
        approval.invoiceDigest = keccak256("wrong invoice");
        _expectApprovalError(approval, OpenBellReceivables.DecisionDoesNotMatchInvoice.selector);
    }

    function test_ApprovalRejectsFutureRiskData() public {
        (OpenBellReceivables.InvoiceTerms memory terms, bytes32 invoiceDigest) = _registered("future", 31);
        OpenBellReceivables.RiskApproval memory approval = _approval(terms, invoiceDigest, 201);
        approval.riskTimestamp = uint64(block.timestamp + 1);
        _expectApprovalError(approval, OpenBellReceivables.RiskDataFromFuture.selector);
    }

    function test_ApprovalRejectsStaleRiskData() public {
        (OpenBellReceivables.InvoiceTerms memory terms, bytes32 invoiceDigest) = _registered("stale", 32);
        OpenBellReceivables.RiskApproval memory approval = _approval(terms, invoiceDigest, 202);
        approval.riskTimestamp = uint64(block.timestamp - MAX_RISK_AGE - 1);
        _expectApprovalError(approval, OpenBellReceivables.StaleRiskData.selector);
    }

    function test_ApprovalAcceptsRiskDataAtExactMaximumAge() public {
        (OpenBellReceivables.InvoiceTerms memory terms, bytes32 invoiceDigest) =
            _registered("risk-boundary", 33);
        OpenBellReceivables.RiskApproval memory approval = _approval(terms, invoiceDigest, 203);
        approval.riskTimestamp = uint64(block.timestamp - MAX_RISK_AGE);
        _fundCustom(approval, UNDERWRITER_PK, funder);
        _assertEq(uint256(_status(terms.invoiceId)), 2, "boundary approval funded");
    }

    function test_ApprovalRejectsExpiredAndAcceptsExpiryAtCurrentBlock() public {
        (OpenBellReceivables.InvoiceTerms memory expiredTerms, bytes32 expiredDigest) =
            _registered("expired", 34);
        OpenBellReceivables.RiskApproval memory expired = _approval(expiredTerms, expiredDigest, 204);
        expired.expiresAt = uint64(block.timestamp - 1);
        _expectApprovalError(expired, OpenBellReceivables.DecisionExpired.selector);

        (OpenBellReceivables.InvoiceTerms memory liveTerms, bytes32 liveDigest) =
            _registered("expiry-boundary", 35);
        OpenBellReceivables.RiskApproval memory live = _approval(liveTerms, liveDigest, 205);
        live.expiresAt = uint64(block.timestamp);
        _fundCustom(live, UNDERWRITER_PK, funder);
        _assertEq(uint256(_status(liveTerms.invoiceId)), 2, "boundary expiry funded");
    }

    function test_ApprovalCannotOutliveInvoice() public {
        (OpenBellReceivables.InvoiceTerms memory terms, bytes32 invoiceDigest) = _registered("outlives", 36);
        OpenBellReceivables.RiskApproval memory approval = _approval(terms, invoiceDigest, 206);
        approval.expiresAt = terms.dueDate + 1;
        _expectApprovalError(approval, OpenBellReceivables.DecisionOutlivesInvoice.selector);
    }

    function test_ApprovalRequiresReasonAndModelHashes() public {
        (OpenBellReceivables.InvoiceTerms memory first, bytes32 firstDigest) = _registered("reason-zero", 37);
        OpenBellReceivables.RiskApproval memory noReason = _approval(first, firstDigest, 207);
        noReason.riskReasonsHash = bytes32(0);
        _expectApprovalError(noReason, OpenBellReceivables.ZeroValue.selector);

        (OpenBellReceivables.InvoiceTerms memory second, bytes32 secondDigest) = _registered("model-zero", 38);
        OpenBellReceivables.RiskApproval memory noModel = _approval(second, secondDigest, 208);
        noModel.modelHash = bytes32(0);
        _expectApprovalError(noModel, OpenBellReceivables.ZeroValue.selector);
    }

    function test_RejectionUsesSameFreshnessAndExpiryGuards() public {
        (OpenBellReceivables.InvoiceTerms memory terms, bytes32 digest) = _registered("reject-stale", 39);
        OpenBellReceivables.RiskRejection memory rejection = _rejection(terms, digest, 209);
        rejection.riskTimestamp = uint64(block.timestamp - MAX_RISK_AGE - 1);
        bytes memory signature = _sign(UNDERWRITER_PK, _manualRejectionDigest(receivables, rejection));

        vm.expectRevert(OpenBellReceivables.StaleRiskData.selector);
        vm.prank(supplier);
        receivables.attestRejection(rejection, signature);
    }

    function _registered(bytes32 salt, uint256 nonce)
        private
        returns (OpenBellReceivables.InvoiceTerms memory terms, bytes32 digest)
    {
        terms = _terms(salt, nonce);
        digest = _register(terms);
    }

    function _expectApprovalError(OpenBellReceivables.RiskApproval memory approval, bytes4 selector) private {
        bytes memory signature = _sign(UNDERWRITER_PK, _manualApprovalDigest(receivables, approval));
        vm.expectRevert(selector);
        vm.prank(funder);
        receivables.fund(approval, signature);
    }

    function _fundCustom(
        OpenBellReceivables.RiskApproval memory approval,
        uint256 signerPrivateKey,
        address fundingAccount
    ) private {
        bytes memory signature = _sign(signerPrivateKey, _manualApprovalDigest(receivables, approval));
        vm.prank(fundingAccount);
        receivables.fund(approval, signature);
    }
}

contract OpenBellReceivablesCapsAndTimeTest is OpenBellTestBase {
    function test_AdvanceAtCapAndFeeAtCapAreAccepted() public {
        OpenBellReceivables.InvoiceTerms memory terms = _terms("caps-ok", 40);
        bytes32 digest = _register(terms);
        OpenBellReceivables.RiskApproval memory approval = _approval(terms, digest, 300);
        approval.advanceAmount = uint128(FACE_VALUE * MAX_ADVANCE_BPS / 10_000);
        approval.repaymentAmount = uint128(uint256(approval.advanceAmount) * (10_000 + MAX_FEE_BPS) / 10_000);
        bytes memory signature = _sign(UNDERWRITER_PK, _manualApprovalDigest(receivables, approval));

        vm.prank(funder);
        receivables.fund(approval, signature);

        _assertEq(uint256(_status(terms.invoiceId)), 2, "cap-bound approval funded");
    }

    function test_ZeroAndOverCapAdvanceAreRejected() public {
        OpenBellReceivables.InvoiceTerms memory zeroTerms = _terms("zero-advance", 41);
        bytes32 zeroDigest = _register(zeroTerms);
        OpenBellReceivables.RiskApproval memory zero = _approval(zeroTerms, zeroDigest, 301);
        zero.advanceAmount = 0;
        zero.repaymentAmount = 0;
        _expectFundingError(zero, OpenBellReceivables.AdvanceExceedsCap.selector);

        OpenBellReceivables.InvoiceTerms memory highTerms = _terms("high-advance", 42);
        bytes32 highDigest = _register(highTerms);
        OpenBellReceivables.RiskApproval memory high = _approval(highTerms, highDigest, 302);
        high.advanceAmount = uint128(FACE_VALUE * MAX_ADVANCE_BPS / 10_000 + 1);
        high.repaymentAmount = high.advanceAmount;
        _expectFundingError(high, OpenBellReceivables.AdvanceExceedsCap.selector);
    }

    function test_RepaymentBelowAdvanceAndAboveFeeCapAreRejected() public {
        OpenBellReceivables.InvoiceTerms memory lowTerms = _terms("low-repay", 43);
        bytes32 lowDigest = _register(lowTerms);
        OpenBellReceivables.RiskApproval memory low = _approval(lowTerms, lowDigest, 303);
        low.repaymentAmount = low.advanceAmount - 1;
        _expectFundingError(low, OpenBellReceivables.InvalidRepayment.selector);

        OpenBellReceivables.InvoiceTerms memory highTerms = _terms("fee-cap", 44);
        bytes32 highDigest = _register(highTerms);
        OpenBellReceivables.RiskApproval memory high = _approval(highTerms, highDigest, 304);
        high.repaymentAmount = uint128(uint256(high.advanceAmount) * (10_000 + MAX_FEE_BPS) / 10_000 + 1);
        _expectFundingError(high, OpenBellReceivables.InvalidRepayment.selector);
    }

    function test_RepaymentCannotExceedInvoiceFaceEvenWithPermissiveFeeCap() public {
        OpenBellReceivables wide = _deploy(address(token), underwriter, 10_000, 10_000);
        vm.prank(funder);
        token.approve(address(wide), type(uint256).max);

        OpenBellReceivables.InvoiceTerms memory terms = _terms("face-cap", 45);
        bytes32 invoiceDigest = _manualInvoiceDigest(wide, terms);
        vm.prank(supplier);
        wide.registerInvoice(terms, _sign(SUPPLIER_PK, invoiceDigest), _sign(PAYER_PK, invoiceDigest));

        OpenBellReceivables.RiskApproval memory approval = _approval(terms, invoiceDigest, 305);
        approval.advanceAmount = uint128(FACE_VALUE);
        approval.repaymentAmount = uint128(FACE_VALUE + 1);
        bytes32 decisionDigest = _manualApprovalDigest(wide, approval);

        vm.expectRevert(OpenBellReceivables.InvalidRepayment.selector);
        vm.prank(funder);
        wide.fund(approval, _sign(UNDERWRITER_PK, decisionDigest));
    }

    function test_RegisterRejectsFutureIssuePastDueAndInvertedDates() public {
        OpenBellReceivables.InvoiceTerms memory future = _terms("future-issue", 46);
        future.issuedAt = uint64(block.timestamp + 1);
        _expectRegistrationError(future, OpenBellReceivables.InvalidInvoiceTime.selector);

        OpenBellReceivables.InvoiceTerms memory due = _terms("past-due", 47);
        due.dueDate = uint64(block.timestamp);
        _expectRegistrationError(due, OpenBellReceivables.InvalidInvoiceTime.selector);

        OpenBellReceivables.InvoiceTerms memory inverted = _terms("inverted", 48);
        inverted.issuedAt = uint64(block.timestamp - 1 hours);
        inverted.dueDate = inverted.issuedAt;
        _expectRegistrationError(inverted, OpenBellReceivables.InvalidInvoiceTime.selector);
    }

    function test_RegisterRejectsOldInvoiceAndExcessiveTenor() public {
        OpenBellReceivables.InvoiceTerms memory old = _terms("too-old", 49);
        old.issuedAt = uint64(block.timestamp - MAX_INVOICE_AGE - 1);
        _expectRegistrationError(old, OpenBellReceivables.InvoiceTooOld.selector);

        OpenBellReceivables.InvoiceTerms memory longTenor = _terms("long-tenor", 50);
        longTenor.issuedAt = uint64(block.timestamp - 1 hours);
        longTenor.dueDate = longTenor.issuedAt + MAX_INVOICE_TENOR + 1;
        _expectRegistrationError(longTenor, OpenBellReceivables.InvoiceTenorTooLong.selector);
    }

    function _expectFundingError(OpenBellReceivables.RiskApproval memory approval, bytes4 selector) private {
        bytes memory signature = _sign(UNDERWRITER_PK, _manualApprovalDigest(receivables, approval));
        vm.expectRevert(selector);
        vm.prank(funder);
        receivables.fund(approval, signature);
    }

    function _expectRegistrationError(OpenBellReceivables.InvoiceTerms memory terms, bytes4 selector)
        private
    {
        bytes32 digest = _manualInvoiceDigest(receivables, terms);
        vm.expectRevert(selector);
        vm.prank(terms.supplier);
        receivables.registerInvoice(terms, _sign(SUPPLIER_PK, digest), _sign(PAYER_PK, digest));
    }
}

contract OpenBellReceivablesAdministrationTest is OpenBellTestBase {
    function test_UnderwriterRotationInvalidatesOldSignatureAndAcceptsNewSigner() public {
        OpenBellReceivables.InvoiceTerms memory terms = _terms("rotate", 60);
        bytes32 invoiceDigest = _register(terms);
        OpenBellReceivables.RiskApproval memory approval = _approval(terms, invoiceDigest, 400);
        bytes32 digest = _manualApprovalDigest(receivables, approval);
        bytes memory oldSignature = _sign(UNDERWRITER_PK, digest);

        receivables.setUnderwriter(newUnderwriter);
        _assertEq(receivables.underwriter(), newUnderwriter, "underwriter rotated");

        vm.expectRevert(abi.encodeWithSelector(OpenBellReceivables.InvalidSignature.selector, newUnderwriter));
        vm.prank(funder);
        receivables.fund(approval, oldSignature);

        vm.prank(funder);
        receivables.fund(approval, _sign(NEW_UNDERWRITER_PK, digest));
        _assertEq(uint256(_status(terms.invoiceId)), 2, "new signer funded");
    }

    function test_DecisionNoncesAreScopedByUnderwriterAcrossRotation() public {
        OpenBellReceivables.InvoiceTerms memory first = _terms("old-underwriter", 61);
        bytes32 firstDigest = _register(first);
        _fund(first, firstDigest, 401);

        receivables.setUnderwriter(newUnderwriter);
        OpenBellReceivables.InvoiceTerms memory second = _terms("new-underwriter", 62);
        bytes32 secondDigest = _register(second);
        OpenBellReceivables.RiskApproval memory approval = _approval(second, secondDigest, 401);
        bytes memory signature = _sign(NEW_UNDERWRITER_PK, _manualApprovalDigest(receivables, approval));

        vm.prank(funder);
        receivables.fund(approval, signature);

        _assertEq(receivables.usedDecisionNonces(underwriter, 401), true, "old nonce consumed");
        _assertEq(receivables.usedDecisionNonces(newUnderwriter, 401), true, "new nonce consumed");
    }

    function test_OnlyOwnerCanRotateUnderwriterAndPause() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        vm.prank(outsider);
        receivables.setUnderwriter(newUnderwriter);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        vm.prank(outsider);
        receivables.pauseOriginations();

        vm.expectRevert(OpenBellReceivables.ZeroAddress.selector);
        receivables.setUnderwriter(address(0));
    }

    function test_PauseBlocksOriginationsButAllowsSettlementAndCancellation() public {
        OpenBellReceivables.InvoiceTerms memory funded = _terms("pause-funded", 63);
        bytes32 fundedDigest = _register(funded);
        _fund(funded, fundedDigest, 402);

        OpenBellReceivables.InvoiceTerms memory cancellable = _terms("pause-cancel", 64);
        _register(cancellable);

        OpenBellReceivables.InvoiceTerms memory blockedRegistration = _terms("pause-register", 65);
        bytes32 blockedDigest = _manualInvoiceDigest(receivables, blockedRegistration);

        receivables.pauseOriginations();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(supplier);
        receivables.registerInvoice(
            blockedRegistration, _sign(SUPPLIER_PK, blockedDigest), _sign(PAYER_PK, blockedDigest)
        );

        vm.prank(supplier);
        receivables.cancelUnfunded(cancellable.invoiceId);
        vm.prank(payer);
        receivables.settle(funded.invoiceId);

        _assertEq(uint256(_status(cancellable.invoiceId)), 4, "cancel allowed while paused");
        _assertEq(uint256(_status(funded.invoiceId)), 3, "settle allowed while paused");
    }

    function test_PauseBlocksFundingAndRejectionThenUnpauseRestoresBoth() public {
        OpenBellReceivables.InvoiceTerms memory fundingTerms = _terms("pause-fund", 66);
        bytes32 fundingDigest = _register(fundingTerms);
        OpenBellReceivables.RiskApproval memory approval = _approval(fundingTerms, fundingDigest, 403);

        OpenBellReceivables.InvoiceTerms memory rejectionTerms = _terms("pause-reject", 67);
        bytes32 rejectionDigest = _register(rejectionTerms);
        OpenBellReceivables.RiskRejection memory rejection = _rejection(rejectionTerms, rejectionDigest, 404);
        bytes memory approvalSignature = _sign(UNDERWRITER_PK, _manualApprovalDigest(receivables, approval));
        bytes memory rejectionSignature =
            _sign(UNDERWRITER_PK, _manualRejectionDigest(receivables, rejection));

        receivables.pauseOriginations();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(funder);
        receivables.fund(approval, approvalSignature);

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(supplier);
        receivables.attestRejection(rejection, rejectionSignature);

        receivables.unpauseOriginations();
        vm.prank(funder);
        receivables.fund(approval, approvalSignature);
        vm.prank(supplier);
        receivables.attestRejection(rejection, rejectionSignature);
    }
}

contract OpenBellReceivablesExactTransferTest is OpenBellTestBase {
    FeeOnTransferERC20 internal feeToken;
    OpenBellReceivables internal feeReceivables;

    function setUp() public override {
        super.setUp();
        feeToken = new FeeOnTransferERC20();
        feeReceivables = _deploy(address(feeToken), underwriter, MAX_ADVANCE_BPS, MAX_FEE_BPS);
        feeToken.mint(funder, 10_000 * UNIT);
        feeToken.mint(payer, 10_000 * UNIT);
        vm.prank(funder);
        feeToken.approve(address(feeReceivables), type(uint256).max);
        vm.prank(payer);
        feeToken.approve(address(feeReceivables), type(uint256).max);
    }

    function test_FeeOnTransferAdvanceRevertsAtomicallyAndCanRetryAfterFeeRemoved() public {
        OpenBellReceivables.InvoiceTerms memory terms = _terms("fee-fund", 70);
        bytes32 invoiceDigest = _registerOn(feeReceivables, terms);
        OpenBellReceivables.RiskApproval memory approval = _approval(terms, invoiceDigest, 500);
        bytes32 approvalDigest = _manualApprovalDigest(feeReceivables, approval);
        bytes memory signature = _sign(UNDERWRITER_PK, approvalDigest);
        uint256 funderBefore = feeToken.balanceOf(funder);
        uint256 supplierBefore = feeToken.balanceOf(supplier);

        feeToken.setFeeBps(100);
        vm.expectRevert(OpenBellReceivables.ExactTransferRequired.selector);
        vm.prank(funder);
        feeReceivables.fund(approval, signature);

        _assertEq(uint256(_statusOn(feeReceivables, terms.invoiceId)), 1, "fund rollback status");
        _assertEq(feeReceivables.usedDecisionNonces(underwriter, approval.nonce), false, "nonce rollback");
        _assertEq(feeToken.balanceOf(funder), funderBefore, "funder balance rollback");
        _assertEq(feeToken.balanceOf(supplier), supplierBefore, "supplier balance rollback");

        feeToken.setFeeBps(0);
        vm.prank(funder);
        feeReceivables.fund(approval, signature);
        _assertEq(uint256(_statusOn(feeReceivables, terms.invoiceId)), 2, "retry funded");
    }

    function test_FeeOnTransferRepaymentRevertsAtomicallyAndCanRetry() public {
        OpenBellReceivables.InvoiceTerms memory terms = _terms("fee-settle", 71);
        bytes32 invoiceDigest = _registerOn(feeReceivables, terms);
        OpenBellReceivables.RiskApproval memory approval = _approval(terms, invoiceDigest, 501);
        bytes memory signature = _sign(UNDERWRITER_PK, _manualApprovalDigest(feeReceivables, approval));
        vm.prank(funder);
        feeReceivables.fund(approval, signature);
        uint256 payerBefore = feeToken.balanceOf(payer);
        uint256 funderBefore = feeToken.balanceOf(funder);

        feeToken.setFeeBps(100);
        vm.expectRevert(OpenBellReceivables.ExactTransferRequired.selector);
        vm.prank(payer);
        feeReceivables.settle(terms.invoiceId);

        _assertEq(uint256(_statusOn(feeReceivables, terms.invoiceId)), 2, "settlement rollback status");
        _assertEq(feeToken.balanceOf(payer), payerBefore, "payer rollback");
        _assertEq(feeToken.balanceOf(funder), funderBefore, "funder rollback");

        feeToken.setFeeBps(0);
        vm.prank(payer);
        feeReceivables.settle(terms.invoiceId);
        _assertEq(uint256(_statusOn(feeReceivables, terms.invoiceId)), 3, "retry settled");
    }

    function _registerOn(OpenBellReceivables instance, OpenBellReceivables.InvoiceTerms memory terms)
        private
        returns (bytes32 digest)
    {
        digest = _manualInvoiceDigest(instance, terms);
        vm.prank(terms.supplier);
        instance.registerInvoice(terms, _sign(SUPPLIER_PK, digest), _sign(PAYER_PK, digest));
    }

    function _statusOn(OpenBellReceivables instance, bytes32 invoiceId)
        private
        view
        returns (OpenBellReceivables.InvoiceStatus status)
    {
        (status,,,,,,,,,,) = instance.invoices(invoiceId);
    }
}

contract OpenBellReceivablesERC1271Test is OpenBellTestBase {
    function test_ContractSupplierAndPayerCanRegisterWithERC1271Signatures() public {
        MockERC1271Wallet contractSupplier = new MockERC1271Wallet();
        MockERC1271Wallet contractPayer = new MockERC1271Wallet();
        OpenBellReceivables.InvoiceTerms memory terms = _terms("1271-parties", 80);
        terms.supplier = address(contractSupplier);
        terms.payer = address(contractPayer);

        bytes32 digest = _manualInvoiceDigest(receivables, terms);
        bytes memory supplierSignature = hex"1271a1";
        bytes memory payerSignature = hex"1271b2";
        contractSupplier.allow(digest, supplierSignature);
        contractPayer.allow(digest, payerSignature);

        vm.prank(address(contractSupplier));
        bytes32 returned = receivables.registerInvoice(terms, supplierSignature, payerSignature);

        _assertEq(returned, digest, "1271 invoice digest");
        _assertEq(uint256(_status(terms.invoiceId)), 1, "1271 parties registered");
    }

    function test_ContractUnderwriterCanApproveAndRejectThroughERC1271() public {
        MockERC1271Wallet contractUnderwriter = new MockERC1271Wallet();
        receivables.setUnderwriter(address(contractUnderwriter));

        OpenBellReceivables.InvoiceTerms memory fundedTerms = _terms("1271-underwriter-fund", 81);
        bytes32 fundedDigest = _register(fundedTerms);
        OpenBellReceivables.RiskApproval memory approval = _approval(fundedTerms, fundedDigest, 600);
        bytes32 approvalDigest = _manualApprovalDigest(receivables, approval);
        bytes memory approvalSignature = hex"aabbcc";
        contractUnderwriter.allow(approvalDigest, approvalSignature);

        vm.prank(funder);
        receivables.fund(approval, approvalSignature);
        _assertEq(uint256(_status(fundedTerms.invoiceId)), 2, "1271 approval funded");

        OpenBellReceivables.InvoiceTerms memory rejectedTerms = _terms("1271-underwriter-reject", 82);
        bytes32 rejectedDigest = _register(rejectedTerms);
        OpenBellReceivables.RiskRejection memory rejection = _rejection(rejectedTerms, rejectedDigest, 601);
        bytes32 rejectionDigest = _manualRejectionDigest(receivables, rejection);
        bytes memory rejectionSignature = hex"ddeeff";
        contractUnderwriter.allow(rejectionDigest, rejectionSignature);

        vm.prank(supplier);
        receivables.attestRejection(rejection, rejectionSignature);
        _assertEq(uint256(_status(rejectedTerms.invoiceId)), 5, "1271 rejection attested");
    }

    function test_InvalidERC1271SignatureFailsWithoutConsumingDecisionNonce() public {
        MockERC1271Wallet contractUnderwriter = new MockERC1271Wallet();
        receivables.setUnderwriter(address(contractUnderwriter));
        OpenBellReceivables.InvoiceTerms memory terms = _terms("1271-invalid", 83);
        bytes32 invoiceDigest = _register(terms);
        OpenBellReceivables.RiskApproval memory approval = _approval(terms, invoiceDigest, 602);

        vm.expectRevert(
            abi.encodeWithSelector(
                OpenBellReceivables.InvalidSignature.selector, address(contractUnderwriter)
            )
        );
        vm.prank(funder);
        receivables.fund(approval, hex"deadbeef");

        _assertEq(
            receivables.usedDecisionNonces(address(contractUnderwriter), approval.nonce),
            false,
            "invalid 1271 nonce untouched"
        );
    }
}
