import { createServiceClient } from "@/lib/supabase/service";
import { getLguDisplay } from "@/lib/lgu";
import { notFound } from "next/navigation";

/**
 * Public permit verification page -- what the QR code on a printed
 * permit (src/lib/permit-pdf.ts) links to. Deliberately unauthenticated
 * (no applicant_session check, unlike /status/[reference]) and
 * deliberately minimal: business name, permit number, dates, and a
 * valid/expired badge -- nothing an inspector or curious customer
 * scanning a posted permit shouldn't be able to see, and nothing
 * financial or personally identifying beyond the business's own name
 * (which is already posted publicly on the permit itself).
 *
 * Uses the service-role client since this is intentionally public --
 * there's no owner session to scope an RLS-authenticated read to here.
 *
 * Resolves the LGU from the permit's own application.lgu_id (CLAUDE.md
 * 7n), not the pilot-LGU placeholder -- unlike the pre-auth pages, this
 * one already has a real per-record LGU to key off of, so there's no
 * reason to fall back to a single-tenant assumption here.
 */
export default async function VerifyPermitPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const supabase = createServiceClient();

  const { data: permit } = await supabase
    .from("permits")
    .select(
      `permit_number, issued_at, valid_until,
       application:applications(application_type, lgu_id, business:businesses(business_name, nature_of_business))`
    )
    .eq("permit_number", reference)
    .maybeSingle();

  if (!permit) notFound();

  const application = permit.application as unknown as {
    application_type: string;
    lgu_id: string;
    business: { business_name: string; nature_of_business: string | null } | null;
  } | null;

  const lgu = application ? await getLguDisplay(supabase, application.lgu_id) : null;

  // Explicit +08:00 (Asia/Manila, fixed offset, no DST) rather than a
  // bare local-time string -- Vercel's functions run in UTC, so an
  // unqualified "T23:59:59" would mean end-of-day UTC, not end-of-day in
  // San Miguel, quietly shifting both the expiry instant and (via
  // toLocaleDateString below) which calendar date gets displayed.
  const validUntil = new Date(`${permit.valid_until}T23:59:59+08:00`);
  const isValid = validUntil >= new Date();

  // fontFamily deliberately not overridden here -- see the identical fix
  // and reasoning in ApplyPageClient.tsx (2026-08-20 audit finding).
  return (
    <div style={{ maxWidth: 480, margin: "32px auto", background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #c7ced8", color: "#1a1a2e" }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: "#6b7280", letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 4 }}>
        MuniServe{lgu ? ` · ${lgu.name}, ${lgu.province}` : ""}
      </p>
      <p style={{ fontWeight: 600, fontSize: 18, margin: "0 0 16px" }}>Permit verification</p>

      <div
        style={{
          background: isValid ? "#EAF3DE" : "#FCEBEB",
          color: isValid ? "#27500A" : "#791F1F",
          fontSize: 13,
          fontWeight: 700,
          padding: "8px 14px",
          borderRadius: 999,
          display: "inline-block",
          marginBottom: 18,
        }}
      >
        {isValid ? "Valid" : "Expired"}
      </div>

      <Row label="Business name" value={application?.business?.business_name ?? "(business record missing)"} />
      <Row label="Permit No." value={permit.permit_number ?? "—"} />
      <Row label="Nature of business" value={application?.business?.nature_of_business ?? "—"} />
      <Row label="Application type" value={application?.application_type === "new" ? "New" : "Renewal"} />
      <Row label="Date issued" value={permit.issued_at ? new Date(permit.issued_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" }) : "—"} />
      <Row label="Valid until" value={validUntil.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" })} />

      <p style={{ fontSize: 11, color: "#6b7280", marginTop: 20 }}>
        This page confirms a permit&rsquo;s validity only. For any other concern, contact the BPLO office{lgu ? ` of ${lgu.name}, ${lgu.province}` : ""}.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid #c7ced8", fontSize: 13 }}>
      <span style={{ color: "#6b7280" }}>{label}</span>
      <span style={{ fontWeight: 500, textAlign: "right" }}>{value}</span>
    </div>
  );
}
