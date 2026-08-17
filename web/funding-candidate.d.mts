export interface ValidatedFundingCandidate {
  readonly invoice: { readonly invoiceId: string };
  readonly authority: { readonly expiresAt: bigint };
}

export function validateFundingCandidate(candidate: unknown, nowSeconds?: number): Promise<ValidatedFundingCandidate>;
export function assertFundingCandidateAgainstInvoice(candidate: ValidatedFundingCandidate, record: unknown): true;
