/**
 * Known, structural reasons a document was uploaded (migration 0062,
 * `documents.purpose`) -- distinct from `document_type`, which is free
 * text the applicant types and can't be relied on for staff-facing UI
 * logic. The first two real cases (2026-08-21): an FSIF payment-proof
 * upload nudged by the Fire Safety Inspection Fee notice (fsif-notice.ts,
 * right after BPLO's initial approval) and a GCash/Bank/Online payment-
 * proof upload nudged by the Accepted Payment Methods notice (payment-
 * methods.ts) -- neither creates an `info_requests` row (nobody formally
 * "asked" for it the way CLAUDE.md 7ll's request-more-info loop does), so
 * there was previously no way for `DocumentList` to distinguish either
 * from a document uploaded as part of the original application.
 *
 * Deliberately its own dependency-free module, not `review-workflow.ts`
 * (which pulls in server-only Supabase clients) -- `ui.tsx`'s
 * `DocumentList` needs these labels and is imported by both server and
 * client components, so a server-only import leaking in here would risk
 * breaking that boundary. `upload-additional-document/route.ts` imports
 * the same map to validate an incoming `purpose` before writing it,
 * so the two can never drift apart on what a purpose value means.
 */
export const DOCUMENT_PURPOSE_LABELS: Record<string, string> = {
  fsif_payment_proof: "🔥 Fire Safety Inspection Fee (FSIF) — payment proof for BFP",
  payment_proof: "💳 Payment proof",
};
