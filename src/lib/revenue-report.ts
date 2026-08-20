import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/db-pagination";

/**
 * Revenue breakdown for the "Reports" half of Stats & Reports (2026-08-17,
 * project owner's request) -- how much has actually been collected, broken
 * into the four buckets the project owner asked for: Barangay Clearance,
 * Engineering, CEDULA, and "Actual Permit" (LBT + Mayor's Permit Fee +
 * every other regulatory fee).
 *
 * Basis is COLLECTED, not assessed/billed (confirmed with the project
 * owner before building) -- only counts fee lines belonging to
 * applications with at least one real `payments` row whose `received_at`
 * falls in the selected range. An application assessed but never paid
 * contributes nothing here, on purpose -- this is a revenue report, not a
 * billing report.
 *
 * "Engineering" is a real nuance worth recording: it's not its own
 * `fee_category` in the schema -- Engineering's Building Permit Fee is
 * written as an ordinary `regulatory`-category line (bplo/page.tsx's
 * `AssessmentCard`, `engineeringLine`), just with `fee_rule_id: null`
 * since it's a typed-in figure with no corresponding `fee_rules` row.
 * That's the one thing that reliably distinguishes it from every other
 * regulatory fee (CNC, Health Permit Fee, Inspection Fee, Plate Fee,
 * Sanitary Fee, ...) -- confirmed directly against production data before
 * relying on it, not assumed from reading the code alone.
 */

export type RevenueBucketKey = "barangay_clearance" | "engineering" | "cedula" | "actual_permit";

export type RevenueLine = {
  applicationId: string;
  referenceNumber: string;
  businessName: string;
  paidAt: string; // ISO -- the earliest payment received for this application within range
  bucket: RevenueBucketKey;
  subCategory: "lbt" | "mayors_permit" | "other_regulatory" | "discount" | null; // only set for actual_permit lines
  displayLabel: string;
  acctCode: string | null;
  amount: number;
};

export type RevenueBucketResult = {
  key: RevenueBucketKey;
  label: string;
  total: number;
  applicationCount: number;
};

export type RevenueReport = {
  buckets: RevenueBucketResult[];
  grandTotal: number;
  paidApplicationCount: number;
  // Actual Permit's own components, since it's a combined figure --
  // lets BPLO see what's actually inside it without opening the CSV.
  actualPermitBreakdown: { label: string; total: number }[];
  lines: RevenueLine[];
};

const BUCKET_LABEL: Record<RevenueBucketKey, string> = {
  barangay_clearance: "Barangay Clearance",
  engineering: "Engineering",
  cedula: "CEDULA",
  actual_permit: "Actual Permit",
};

export async function computeRevenueReport(
  supabase: SupabaseClient,
  lguId: string,
  range: { from: string; to: string }
): Promise<RevenueReport> {
  const fromIso = `${range.from}T00:00:00.000Z`;
  const toIso = `${range.to}T23:59:59.999Z`;

  // Every payment in range at this LGU, earliest-first -- an application
  // can have more than one payment row; only the earliest received_at in
  // range is kept per application (below), so a re-recorded/second
  // payment doesn't double-count that application's fee lines.
  type PaymentRow = { application_id: string; received_at: string; application: { reference_number: string; business: { business_name: string } | null } | null };
  const rawPaymentRows = await fetchAllRows<Record<string, unknown>>((offset, limit) =>
    supabase
      .from("payments")
      .select("application_id, received_at, application:applications!inner(lgu_id, reference_number, business:businesses(business_name))", { count: "exact" })
      .eq("application.lgu_id", lguId)
      .gte("received_at", fromIso)
      .lte("received_at", toIso)
      .order("received_at", { ascending: true })
      .range(offset, offset + limit - 1)
  );
  const paymentRows = rawPaymentRows as unknown as PaymentRow[];

  const paidAtByApp = new Map<string, string>();
  const referenceByApp = new Map<string, string>();
  const businessNameByApp = new Map<string, string>();
  for (const p of paymentRows) {
    if (!paidAtByApp.has(p.application_id)) paidAtByApp.set(p.application_id, p.received_at);
    if (!referenceByApp.has(p.application_id)) referenceByApp.set(p.application_id, p.application?.reference_number ?? "");
    if (!businessNameByApp.has(p.application_id)) businessNameByApp.set(p.application_id, p.application?.business?.business_name ?? "(business record missing)");
  }
  const paidApplicationIds = Array.from(paidAtByApp.keys());

  if (paidApplicationIds.length === 0) {
    return {
      buckets: (["barangay_clearance", "engineering", "cedula", "actual_permit"] as RevenueBucketKey[]).map((key) => ({
        key,
        label: BUCKET_LABEL[key],
        total: 0,
        applicationCount: 0,
      })),
      grandTotal: 0,
      paidApplicationCount: 0,
      actualPermitBreakdown: [
        { label: "Local Business Tax", total: 0 },
        { label: "Mayor's Permit Fee", total: 0 },
        { label: "Other regulatory fees", total: 0 },
      ],
      lines: [],
    };
  }

  // Only lines actually counted toward what the applicant owed online --
  // excludes a reference_only (counter-paid) CEDULA line and anything
  // else deliberately not part of the online total.
  const feeLineRows = await fetchAllRows<{
    application_id: string;
    fee_rule_id: string | null;
    fee_category: string | null;
    display_label: string | null;
    acct_code: string | null;
    computed_amount: number;
    overridden_amount: number | null;
  }>((offset, limit) =>
    supabase
      .from("application_fee_lines")
      .select("application_id, fee_rule_id, fee_category, display_label, acct_code, computed_amount, overridden_amount", { count: "exact" })
      .in("application_id", paidApplicationIds)
      .eq("included_in_total", true)
      .range(offset, offset + limit - 1)
  );

  const lines: RevenueLine[] = [];
  for (const f of feeLineRows) {
    const amount = Number(f.overridden_amount ?? f.computed_amount);
    const applicationId = f.application_id;
    const paidAt = paidAtByApp.get(applicationId);
    if (!paidAt) continue; // shouldn't happen -- fee lines were fetched by paidApplicationIds

    let bucket: RevenueBucketKey;
    let subCategory: RevenueLine["subCategory"] = null;
    if (f.fee_category === "barangay_clearance") {
      bucket = "barangay_clearance";
    } else if (f.fee_category === "cedula") {
      bucket = "cedula";
    } else if (f.fee_category === "regulatory" && f.fee_rule_id === null) {
      bucket = "engineering";
    } else {
      bucket = "actual_permit";
      subCategory = f.fee_category === "lbt" ? "lbt" : f.fee_category === "mayors_permit" ? "mayors_permit" : f.fee_category === "discount" ? "discount" : "other_regulatory";
    }

    lines.push({
      applicationId,
      referenceNumber: referenceByApp.get(applicationId) ?? "",
      businessName: businessNameByApp.get(applicationId) ?? "(business record missing)",
      paidAt,
      bucket,
      subCategory,
      displayLabel: f.display_label ?? "(unlabeled fee)",
      acctCode: f.acct_code,
      amount,
    });
  }

  const buckets: RevenueBucketResult[] = (["barangay_clearance", "engineering", "cedula", "actual_permit"] as RevenueBucketKey[]).map((key) => {
    const bucketLines = lines.filter((l) => l.bucket === key);
    return {
      key,
      label: BUCKET_LABEL[key],
      total: bucketLines.reduce((sum, l) => sum + l.amount, 0),
      applicationCount: new Set(bucketLines.map((l) => l.applicationId)).size,
    };
  });

  // QA sweep finding (2026-08-20): the essential-commodity discount (its
  // own "discount" fee_category, a reduction specifically against the LBT
  // line -- see fee-engine.ts) used to be folded into "Other regulatory
  // fees" here, which has nothing to do with it. Grand totals were never
  // wrong (the discount's amount landed in the actual_permit bucket total
  // either way), but the two sub-numbers below were: Local Business Tax
  // read too high (not netted against its own discount) and Other
  // regulatory fees read too low (absorbing a discount that isn't a
  // regulatory charge). Netted against Local Business Tax instead, matching
  // how the fee engine itself already treats this discount as a reduction
  // of the LBT line, not a regulatory adjustment.
  const actualPermitLines = lines.filter((l) => l.bucket === "actual_permit");
  const actualPermitBreakdown = [
    {
      label: "Local Business Tax",
      total: actualPermitLines.filter((l) => l.subCategory === "lbt" || l.subCategory === "discount").reduce((s, l) => s + l.amount, 0),
    },
    { label: "Mayor's Permit Fee", total: actualPermitLines.filter((l) => l.subCategory === "mayors_permit").reduce((s, l) => s + l.amount, 0) },
    {
      label: "Other regulatory fees",
      total: actualPermitLines.filter((l) => l.subCategory === "other_regulatory").reduce((s, l) => s + l.amount, 0),
    },
  ];

  return {
    buckets,
    grandTotal: buckets.reduce((s, b) => s + b.total, 0),
    paidApplicationCount: paidApplicationIds.length,
    actualPermitBreakdown,
    lines: lines.sort((a, b) => (a.paidAt < b.paidAt ? -1 : 1)),
  };
}
