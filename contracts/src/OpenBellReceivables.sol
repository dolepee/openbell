// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OpenBellReceivables
/// @notice Exact, fixed-term invoice advances approved by a bounded underwriting signer.
/// @dev Invoice documents remain offchain. Only their canonical hashes and financing state are stored.
contract OpenBellReceivables is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;

    bytes32 public constant INVOICE_TYPEHASH = keccak256(
        "InvoiceTerms(bytes32 invoiceId,bytes32 documentHash,address supplier,address payer,uint128 faceValue,uint64 issuedAt,uint64 dueDate,uint256 nonce)"
    );

    bytes32 public constant APPROVAL_TYPEHASH = keccak256(
        "RiskApproval(bytes32 invoiceId,bytes32 invoiceDigest,address funder,uint128 advanceAmount,uint128 repaymentAmount,uint64 riskTimestamp,uint64 expiresAt,bytes32 riskReasonsHash,bytes32 modelHash,uint256 nonce)"
    );

    bytes32 public constant REJECTION_TYPEHASH = keccak256(
        "RiskRejection(bytes32 invoiceId,bytes32 invoiceDigest,uint64 riskTimestamp,uint64 expiresAt,bytes32 riskReasonsHash,bytes32 modelHash,uint256 nonce)"
    );

    enum InvoiceStatus {
        NONE,
        REGISTERED,
        FUNDED,
        SETTLED,
        CANCELLED,
        REJECTED
    }

    struct InvoiceTerms {
        bytes32 invoiceId;
        bytes32 documentHash;
        address supplier;
        address payer;
        uint128 faceValue;
        uint64 issuedAt;
        uint64 dueDate;
        uint256 nonce;
    }

    struct RiskApproval {
        bytes32 invoiceId;
        bytes32 invoiceDigest;
        address funder;
        uint128 advanceAmount;
        uint128 repaymentAmount;
        uint64 riskTimestamp;
        uint64 expiresAt;
        bytes32 riskReasonsHash;
        bytes32 modelHash;
        uint256 nonce;
    }

    struct RiskRejection {
        bytes32 invoiceId;
        bytes32 invoiceDigest;
        uint64 riskTimestamp;
        uint64 expiresAt;
        bytes32 riskReasonsHash;
        bytes32 modelHash;
        uint256 nonce;
    }

    struct InvoiceRecord {
        InvoiceStatus status;
        address supplier;
        address payer;
        address funder;
        uint128 faceValue;
        uint128 advanceAmount;
        uint128 repaymentAmount;
        uint64 dueDate;
        bytes32 documentHash;
        bytes32 invoiceDigest;
        bytes32 decisionDigest;
    }

    IERC20 public immutable settlementToken;
    uint16 public immutable maxAdvanceBps;
    uint16 public immutable maxFeeBps;
    uint64 public immutable maxRiskAge;
    uint64 public immutable maxInvoiceAge;
    uint64 public immutable maxInvoiceTenor;

    address public underwriter;

    mapping(bytes32 invoiceId => InvoiceRecord) public invoices;
    mapping(bytes32 digest => bool used) public usedInvoiceDigests;
    mapping(bytes32 documentHash => bool used) public usedDocumentHashes;
    mapping(address signer => mapping(uint256 nonce => bool used)) public usedPartyNonces;
    mapping(address signer => mapping(uint256 nonce => bool used)) public usedDecisionNonces;

    error ZeroAddress();
    error ZeroValue();
    error SameParty();
    error Unauthorized();
    error InvalidStatus(InvoiceStatus expected, InvoiceStatus actual);
    error InvalidSignature(address expectedSigner);
    error InvalidInvoiceTime();
    error InvoiceTooOld();
    error InvoiceTenorTooLong();
    error DuplicateInvoice();
    error DuplicateDocument();
    error NonceUsed(address signer, uint256 nonce);
    error DecisionDoesNotMatchInvoice();
    error RiskDataFromFuture();
    error StaleRiskData();
    error DecisionExpired();
    error DecisionOutlivesInvoice();
    error AdvanceExceedsCap();
    error InvalidRepayment();
    error ExactTransferRequired();

    event InvoiceRegistered(
        bytes32 indexed invoiceId,
        bytes32 indexed invoiceDigest,
        address indexed supplier,
        address payer,
        uint128 faceValue,
        uint64 dueDate,
        bytes32 documentHash
    );
    event InvoiceFunded(
        bytes32 indexed invoiceId,
        bytes32 indexed decisionDigest,
        address indexed funder,
        address supplier,
        uint128 advanceAmount,
        uint128 repaymentAmount,
        bytes32 riskReasonsHash,
        bytes32 modelHash
    );
    event InvoiceRejected(
        bytes32 indexed invoiceId, bytes32 indexed decisionDigest, bytes32 riskReasonsHash, bytes32 modelHash
    );
    event InvoiceSettled(
        bytes32 indexed invoiceId, address indexed payer, address indexed funder, uint128 repaymentAmount
    );
    event InvoiceCancelled(bytes32 indexed invoiceId, address indexed supplier);
    event UnderwriterUpdated(address indexed previousUnderwriter, address indexed newUnderwriter);

    constructor(
        address settlementToken_,
        address initialOwner_,
        address underwriter_,
        uint16 maxAdvanceBps_,
        uint16 maxFeeBps_,
        uint64 maxRiskAge_,
        uint64 maxInvoiceAge_,
        uint64 maxInvoiceTenor_
    ) EIP712("OpenBell Receivables", "1") Ownable(initialOwner_) {
        if (settlementToken_ == address(0) || initialOwner_ == address(0) || underwriter_ == address(0)) {
            revert ZeroAddress();
        }
        if (
            maxAdvanceBps_ == 0 || maxAdvanceBps_ > BPS || maxFeeBps_ > BPS || maxRiskAge_ == 0
                || maxInvoiceAge_ == 0 || maxInvoiceTenor_ == 0
        ) revert ZeroValue();

        settlementToken = IERC20(settlementToken_);
        underwriter = underwriter_;
        maxAdvanceBps = maxAdvanceBps_;
        maxFeeBps = maxFeeBps_;
        maxRiskAge = maxRiskAge_;
        maxInvoiceAge = maxInvoiceAge_;
        maxInvoiceTenor = maxInvoiceTenor_;
    }

    function registerInvoice(
        InvoiceTerms calldata terms,
        bytes calldata supplierSignature,
        bytes calldata payerSignature
    ) external nonReentrant whenNotPaused returns (bytes32 invoiceDigest) {
        if (msg.sender != terms.supplier) revert Unauthorized();
        if (terms.supplier == address(0) || terms.payer == address(0)) revert ZeroAddress();
        if (terms.supplier == terms.payer) revert SameParty();
        if (terms.invoiceId == bytes32(0) || terms.documentHash == bytes32(0) || terms.faceValue == 0) {
            revert ZeroValue();
        }
        if (
            terms.issuedAt > block.timestamp || terms.dueDate <= block.timestamp
                || terms.dueDate <= terms.issuedAt
        ) {
            revert InvalidInvoiceTime();
        }
        if (block.timestamp - terms.issuedAt > maxInvoiceAge) revert InvoiceTooOld();
        if (terms.dueDate - terms.issuedAt > maxInvoiceTenor) revert InvoiceTenorTooLong();

        invoiceDigest = hashInvoice(terms);
        if (invoices[terms.invoiceId].status != InvoiceStatus.NONE || usedInvoiceDigests[invoiceDigest]) {
            revert DuplicateInvoice();
        }
        if (usedDocumentHashes[terms.documentHash]) revert DuplicateDocument();
        _requireUnusedPartyNonce(terms.supplier, terms.nonce);
        _requireUnusedPartyNonce(terms.payer, terms.nonce);
        _requireSignature(terms.supplier, invoiceDigest, supplierSignature);
        _requireSignature(terms.payer, invoiceDigest, payerSignature);

        usedPartyNonces[terms.supplier][terms.nonce] = true;
        usedPartyNonces[terms.payer][terms.nonce] = true;
        usedInvoiceDigests[invoiceDigest] = true;
        usedDocumentHashes[terms.documentHash] = true;
        invoices[terms.invoiceId] = InvoiceRecord({
            status: InvoiceStatus.REGISTERED,
            supplier: terms.supplier,
            payer: terms.payer,
            funder: address(0),
            faceValue: terms.faceValue,
            advanceAmount: 0,
            repaymentAmount: 0,
            dueDate: terms.dueDate,
            documentHash: terms.documentHash,
            invoiceDigest: invoiceDigest,
            decisionDigest: bytes32(0)
        });

        emit InvoiceRegistered(
            terms.invoiceId,
            invoiceDigest,
            terms.supplier,
            terms.payer,
            terms.faceValue,
            terms.dueDate,
            terms.documentHash
        );
    }

    function fund(RiskApproval calldata approval, bytes calldata underwriterSignature)
        external
        nonReentrant
        whenNotPaused
        returns (bytes32 decisionDigest)
    {
        InvoiceRecord storage invoice = invoices[approval.invoiceId];
        _requireStatus(invoice.status, InvoiceStatus.REGISTERED);
        if (approval.funder == address(0)) revert ZeroAddress();
        if (msg.sender != approval.funder) revert Unauthorized();
        if (msg.sender == invoice.supplier || msg.sender == invoice.payer) revert SameParty();

        _validateDecisionEnvelope(
            approval.invoiceDigest,
            invoice.invoiceDigest,
            invoice.dueDate,
            approval.riskTimestamp,
            approval.expiresAt,
            approval.riskReasonsHash,
            approval.modelHash
        );
        _requireUnusedDecisionNonce(underwriter, approval.nonce);

        uint256 maxAdvance = uint256(invoice.faceValue) * maxAdvanceBps / BPS;
        if (approval.advanceAmount == 0 || approval.advanceAmount > maxAdvance) revert AdvanceExceedsCap();
        uint256 maxRepayment = uint256(approval.advanceAmount) * (BPS + maxFeeBps) / BPS;
        if (
            approval.repaymentAmount < approval.advanceAmount || approval.repaymentAmount > maxRepayment
                || approval.repaymentAmount > invoice.faceValue
        ) revert InvalidRepayment();

        decisionDigest = hashApproval(approval);
        _requireSignature(underwriter, decisionDigest, underwriterSignature);
        usedDecisionNonces[underwriter][approval.nonce] = true;

        invoice.status = InvoiceStatus.FUNDED;
        invoice.funder = msg.sender;
        invoice.advanceAmount = approval.advanceAmount;
        invoice.repaymentAmount = approval.repaymentAmount;
        invoice.decisionDigest = decisionDigest;

        _transferExactFrom(msg.sender, invoice.supplier, approval.advanceAmount);

        emit InvoiceFunded(
            approval.invoiceId,
            decisionDigest,
            msg.sender,
            invoice.supplier,
            approval.advanceAmount,
            approval.repaymentAmount,
            approval.riskReasonsHash,
            approval.modelHash
        );
    }

    function attestRejection(RiskRejection calldata rejection, bytes calldata underwriterSignature)
        external
        nonReentrant
        whenNotPaused
        returns (bytes32 decisionDigest)
    {
        InvoiceRecord storage invoice = invoices[rejection.invoiceId];
        _requireStatus(invoice.status, InvoiceStatus.REGISTERED);
        if (msg.sender != invoice.supplier) revert Unauthorized();

        _validateDecisionEnvelope(
            rejection.invoiceDigest,
            invoice.invoiceDigest,
            invoice.dueDate,
            rejection.riskTimestamp,
            rejection.expiresAt,
            rejection.riskReasonsHash,
            rejection.modelHash
        );
        _requireUnusedDecisionNonce(underwriter, rejection.nonce);

        decisionDigest = hashRejection(rejection);
        _requireSignature(underwriter, decisionDigest, underwriterSignature);
        usedDecisionNonces[underwriter][rejection.nonce] = true;

        invoice.status = InvoiceStatus.REJECTED;
        invoice.decisionDigest = decisionDigest;

        emit InvoiceRejected(
            rejection.invoiceId, decisionDigest, rejection.riskReasonsHash, rejection.modelHash
        );
    }

    function settle(bytes32 invoiceId) external nonReentrant {
        InvoiceRecord storage invoice = invoices[invoiceId];
        _requireStatus(invoice.status, InvoiceStatus.FUNDED);
        if (msg.sender != invoice.payer) revert Unauthorized();

        invoice.status = InvoiceStatus.SETTLED;
        _transferExactFrom(msg.sender, invoice.funder, invoice.repaymentAmount);

        emit InvoiceSettled(invoiceId, msg.sender, invoice.funder, invoice.repaymentAmount);
    }

    function cancelUnfunded(bytes32 invoiceId) external {
        InvoiceRecord storage invoice = invoices[invoiceId];
        _requireStatus(invoice.status, InvoiceStatus.REGISTERED);
        if (msg.sender != invoice.supplier) revert Unauthorized();

        invoice.status = InvoiceStatus.CANCELLED;
        emit InvoiceCancelled(invoiceId, msg.sender);
    }

    function setUnderwriter(address newUnderwriter) external onlyOwner {
        if (newUnderwriter == address(0)) revert ZeroAddress();
        address previousUnderwriter = underwriter;
        underwriter = newUnderwriter;
        emit UnderwriterUpdated(previousUnderwriter, newUnderwriter);
    }

    /// @notice Pauses registrations, funding, and new rejection attestations. Existing settlements remain live.
    function pauseOriginations() external onlyOwner {
        _pause();
    }

    function unpauseOriginations() external onlyOwner {
        _unpause();
    }

    function hashInvoice(InvoiceTerms calldata terms) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    INVOICE_TYPEHASH,
                    terms.invoiceId,
                    terms.documentHash,
                    terms.supplier,
                    terms.payer,
                    terms.faceValue,
                    terms.issuedAt,
                    terms.dueDate,
                    terms.nonce
                )
            )
        );
    }

    function hashApproval(RiskApproval calldata approval) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    APPROVAL_TYPEHASH,
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
            )
        );
    }

    function hashRejection(RiskRejection calldata rejection) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    REJECTION_TYPEHASH,
                    rejection.invoiceId,
                    rejection.invoiceDigest,
                    rejection.riskTimestamp,
                    rejection.expiresAt,
                    rejection.riskReasonsHash,
                    rejection.modelHash,
                    rejection.nonce
                )
            )
        );
    }

    function _validateDecisionEnvelope(
        bytes32 suppliedInvoiceDigest,
        bytes32 storedInvoiceDigest,
        uint64 dueDate,
        uint64 riskTimestamp,
        uint64 expiresAt,
        bytes32 riskReasonsHash,
        bytes32 modelHash
    ) private view {
        if (suppliedInvoiceDigest != storedInvoiceDigest) {
            revert DecisionDoesNotMatchInvoice();
        }
        if (riskTimestamp > block.timestamp) revert RiskDataFromFuture();
        if (block.timestamp - riskTimestamp > maxRiskAge) revert StaleRiskData();
        if (expiresAt < block.timestamp) revert DecisionExpired();
        if (expiresAt > dueDate) revert DecisionOutlivesInvoice();
        if (riskReasonsHash == bytes32(0) || modelHash == bytes32(0)) revert ZeroValue();
    }

    function _requireSignature(address expectedSigner, bytes32 digest, bytes calldata signature)
        private
        view
    {
        if (!SignatureChecker.isValidSignatureNowCalldata(expectedSigner, digest, signature)) {
            revert InvalidSignature(expectedSigner);
        }
    }

    function _requireUnusedPartyNonce(address signer, uint256 nonce) private view {
        if (usedPartyNonces[signer][nonce]) revert NonceUsed(signer, nonce);
    }

    function _requireUnusedDecisionNonce(address signer, uint256 nonce) private view {
        if (usedDecisionNonces[signer][nonce]) revert NonceUsed(signer, nonce);
    }

    function _requireStatus(InvoiceStatus actual, InvoiceStatus expected) private pure {
        if (actual != expected) revert InvalidStatus(expected, actual);
    }

    function _transferExactFrom(address sender, address recipient, uint256 amount) private {
        uint256 senderBefore = settlementToken.balanceOf(sender);
        uint256 recipientBefore = settlementToken.balanceOf(recipient);
        settlementToken.safeTransferFrom(sender, recipient, amount);
        uint256 senderAfter = settlementToken.balanceOf(sender);
        uint256 recipientAfter = settlementToken.balanceOf(recipient);

        if (senderBefore < senderAfter || recipientAfter < recipientBefore) revert ExactTransferRequired();
        if (senderBefore - senderAfter != amount || recipientAfter - recipientBefore != amount) {
            revert ExactTransferRequired();
        }
    }
}
