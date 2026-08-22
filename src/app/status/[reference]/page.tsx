import { getApplicantOwnerId } from "@/lib/applicant-session";
import { maskPhone } from "@/lib/mask";
import { getLguDisplay } from "@/lib/lgu";
import { anyChannelNeedsProofUpload, getEnabledPaymentChannels } from "@/lib/payment-methods";
import { createServiceClient } from "@/lib/supabase/service";
import { notFound } from "next/navigation";
import { AdditionalDocumentUpload } from "./upload-form";
import { VerifyPhoneCard } from "./verify-phone-form";
import { SignOutButton } from "./sign-out-button";

/**
 * Status tracker (reference/MuniServe_Applicant_Flow_Prototype.html's
 * renderStatus()), backed by real applications/department_reviews.
 *
 * Reference numbers are sequential per LGU per year (MS-2026-00001,
 * 00002, ...) -- trivially enumerable, unlike a random token. Showing
 * business name, address, and fee amounts to anyone who can guess the
 * next number would be a real data leak, so this requires the same
 * applicant_session cookie set at submission time rather than being an
 * open lookup. If that session isn't present (different browser/device,
 * or cookies cleared), this asks the applicant to return to where they
 * submitted rather than re-authenticating here -- a proper "verify your
 * phone to re-link this session" flow is reasonable future work once
 * SMS status notifications (not yet built) give people a reason to check
 * status from a different device than the one they applied on.
 */
export default async function StatusPage({ params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const ownerId = await getApplicantOwnerId();

  const supabase = createServiceClient();
  const { data: application } = await supabase
    .from("applications")
    .select(
      "id, lgu_id, status, submitted_at, business:businesses(business_name, owner_id, owner:owners(phone))"
    )
    .eq("reference_number", reference)
    .maybeSingle();

  if (!application) notFound();

  const business = application.business as unknown as {
    business_name: string;
    owner_id: string | null;
    owner: { phone: string | null } | null;
  } | null;

  if (!ownerId || !business || business.owner_id !== ownerId) {
    const phone = business?.owner?.phone ?? null;
    return (
      <Shell>
        <Head title="Can't verify this application here" sub={`Reference ${reference}`} />
        <Card>
          <p style={{ fontSize: 13 }}>
            We can&rsquo;t confirm this application belongs to you in this browser.{" "}
            {phone
              ? "Verify with the phone on file below, or check its status from the device and browser you used to submit it."
              : "Please check its status from the device and browser you used to submit it, or contact the BPLO office for help."}
          </p>
          {phone && <VerifyPhoneCard applicationId={application.id} maskedPhone={maskPhone(phone)} />}
        </Card>
      </Shell>
    );
  }

  // One visual stage per real status -- matches the staff-side pipeline
  // (CLAUDE.md 7i) 1:1 now that printing and release are their own
  // checkpoints, so no merging/translation layer is needed here anymore.
  const visualStages = [
    { key: "pending_bplo_initial", label: "Initial review" },
    { key: "pending_dept_review", label: "Department review" },
    { key: "pending_bplo_assessment", label: "Assessment" },
    { key: "pending_payment", label: "Payment" },
    { key: "pending_printing", label: "Printing your permit" },
    { key: "pending_mayor", label: "Mayor's signature" },
    { key: "pending_release", label: "Ready for release" },
    { key: "released", label: "Released" },
  ];
  const currentIdx = visualStages.findIndex((s) => s.key === application.status);

  if (application.status === "returned_to_applicant") {
    return (
      <Shell>
        <Head title={business.business_name} sub={`Reference ${reference}`} />
        <SignOutButton />
        <OpenInfoRequestsCard applicationId={application.id} fallbackTitle="Returned for corrections" />
        <UploadCard applicationId={application.id} />
      </Shell>
    );
  }

  if (application.status === "rejected") {
    return (
      <Shell>
        <Head title={business.business_name} sub={`Reference ${reference}`} />
        <SignOutButton />
        <Card>
          <p style={{ fontSize: 13, fontWeight: 500 }}>Application rejected</p>
          <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Please contact the BPLO office for details.</p>
        </Card>
      </Shell>
    );
  }

  if (application.status === "archived") {
    return (
      <Shell>
        <Head title={business.business_name} sub={`Reference ${reference}`} />
        <SignOutButton />
        <Card>
          <p style={{ fontSize: 13, fontWeight: 500 }}>Application closed</p>
          <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
            This application was closed by BPLO. If you&rsquo;d still like to proceed, please visit the BPLO office.
          </p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Head title={business.business_name} sub={`Reference ${reference}`} />
      <SignOutButton />
      <div style={{ display: "flex", marginBottom: "1.5rem" }}>
        {visualStages.map((s, i) => {
          const done = i < currentIdx;
          const current = i === currentIdx;
          const bg = done ? "#EAF3DE" : current ? "#E6F1FB" : "#f4f6fb";
          const fg = done ? "#27500A" : current ? "#0C447C" : "#6b7280";
          return (
            <div key={s.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, textAlign: "center" }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, marginBottom: 4, background: bg, color: fg }}>
                {done ? "✓" : i + 1}
              </div>
              <span style={{ fontSize: 10, color: "#6b7280" }}>{s.label}</span>
            </div>
          );
        })}
      </div>
      {application.status === "pending_dept_review" && (
        <>
          <OpenInfoRequestsCard applicationId={application.id} />
          <FsifPaymentSection applicationId={application.id} />
          <UploadCard applicationId={application.id} />
        </>
      )}
      {application.status === "pending_payment" && (
        <PendingPaymentSection applicationId={application.id} lguId={application.lgu_id} />
      )}
      {application.status === "released" && <ReleasedNote applicationId={application.id} />}
    </Shell>
  );
}

/** Matches the prototype's "Permit released -- Download your permit or pick it up at the BPLO counter" copy. pdf_url can still be null if PDF generation failed at signing time (best-effort, see mayor/actions.ts's signPermit) -- falls back to the counter-pickup line rather than a dead link. */
async function ReleasedNote({ applicationId }: { applicationId: string }) {
  const supabase = createServiceClient();
  const { data: permit } = await supabase.from("permits").select("pdf_url").eq("application_id", applicationId).maybeSingle();

  return (
    <Card>
      <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Permit released</p>
      <p style={{ fontSize: 12, color: "#6b7280", marginBottom: permit?.pdf_url ? 10 : 0 }}>
        {permit?.pdf_url
          ? "Download your permit below, or pick up a physical copy at the BPLO counter."
          : "Pick up your permit at the BPLO counter."}
      </p>
      {permit?.pdf_url && (
        <a
          href={permit.pdf_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-block", fontSize: 13, padding: "10px 16px", minHeight: 44, borderRadius: 8, border: "1px solid #c7ced8", background: "#0C447C", color: "#fff", fontWeight: 600, textDecoration: "none" }}
        >
          Download permit (PDF)
        </a>
      )}
    </Card>
  );
}

/**
 * Shows every still-open info_requests row for this application (2026-08-16
 * -- closing the "request more info" loop, CLAUDE.md) -- one shared
 * source across all three reviewing surfaces (BPLO's own initial review,
 * any department, Treasury), replacing what used to be a department_
 * reviews-only query that only ever covered one of the three. Uploading
 * anything on this page (UploadCard, right below wherever this renders)
 * auto-resolves and routes every one of these back to whoever asked --
 * no "contact the BPLO office to let them know" step needed anymore.
 *
 * fallbackTitle covers the one status (returned_to_applicant) that used
 * to render a hardcoded dead-end message even when, for some reason,
 * there's no actual info_requests row on file (e.g. a pre-migration
 * application returned before this table existed) -- still tells the
 * applicant *something* useful rather than an empty page.
 */
async function OpenInfoRequestsCard({ applicationId, fallbackTitle }: { applicationId: string; fallbackTitle?: string }) {
  const supabase = createServiceClient();
  const { data: requests } = await supabase
    .from("info_requests")
    .select("requested_by_role, department, notes")
    .eq("application_id", applicationId)
    .is("resolved_at", null);

  const open = requests ?? [];

  function roleLabel(r: { requested_by_role: string; department: string | null }): string {
    if (r.requested_by_role === "department") return r.department ?? "A department";
    if (r.requested_by_role === "treasury") return "Treasury";
    return "BPLO";
  }

  if (open.length === 0) {
    if (!fallbackTitle) return null;
    return (
      <Card>
        <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{fallbackTitle}</p>
        <p style={{ fontSize: 12, color: "#6b7280" }}>Please contact the BPLO office for details on what needs to be corrected.</p>
      </Card>
    );
  }

  return (
    <Card>
      <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
        {open.map(roleLabel).join(", ")} need{open.length === 1 ? "s" : ""} more information
      </p>
      {open.map((r, i) => (
        <p key={i} style={{ fontSize: 12, color: "#6b7280" }}>
          {roleLabel(r)}: {r.notes ?? "No additional details were given -- contact the BPLO office for more info."}
        </p>
      ))}
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
        Upload what&rsquo;s needed below and it&rsquo;ll go straight back for another look -- no need to call or visit in person.
      </p>
    </Card>
  );
}

/**
 * Generic "add a document" upload, always available on this page's relevant
 * statuses -- not tied to a specific info_requests row, since the applicant
 * might have something to add that nobody formally asked for (the BFP
 * payment-proof case, CLAUDE.md section 7c, is the original motivating
 * one). Uploading here also auto-resolves any open info_requests
 * (upload-additional-document/route.ts).
 *
 * defaultLabel is pre-filled from the most recent open request's own note
 * (2026-08-17) rather than left blank -- "documentType" is a required
 * field server-side (upload-additional-document/route.ts), and an
 * applicant who picks a file without typing anything into a blank text
 * field first got a generic "Could not save that upload" with no
 * indication why. Pre-filling with what was actually asked for fixes the
 * common case outright; the field stays editable for the unprompted-upload
 * case, which has nothing sensible to pre-fill.
 */
async function UploadCard({
  applicationId, promptOverride, defaultLabelOverride, purpose,
}: {
  applicationId: string; promptOverride?: string; defaultLabelOverride?: string;
  /** A known key from document-purpose.ts -- flags this specific upload for a highlighted card on staff's own DocumentList (no info_requests row exists for a proactive-notice-driven upload like this, unlike the request-more-info loop). */
  purpose?: string;
}) {
  const supabase = createServiceClient();
  const { data: openRequest } = await supabase
    .from("info_requests")
    .select("notes")
    .eq("application_id", applicationId)
    .is("resolved_at", null)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <Card>
      <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Have a document to add?</p>
      <p style={{ fontSize: 12, color: "#6b7280" }}>
        {promptOverride ?? "Upload it here -- if a department, BPLO, or Treasury asked for something specific, it’ll be sent straight back to them."}
      </p>
      <AdditionalDocumentUpload applicationId={applicationId} defaultLabel={openRequest?.notes || defaultLabelOverride || ""} purpose={purpose} />
    </Card>
  );
}

/**
 * Fire Safety Inspection Fee (FSIF) payment-proof upload (2026-08-21) --
 * the applicant already got a branded email right after BPLO's initial
 * approval explaining BFP works independently and linking back to this
 * exact page (fsif-notice.ts); this is that page's own upload prompt,
 * tagged with purpose="fsif_payment_proof" so the resulting document gets
 * a distinct highlighted card on BFP's own department review queue
 * instead of blending into the rest of the application's documents (the
 * project owner's own direct report -- "nothing would make BFP staff
 * realize the applicant already paid").
 *
 * Gated on real data, not a query param from the notice email's own
 * link -- renders only while BFP genuinely still has a pending decision
 * in the application's current review round, so this doesn't linger on
 * the page (or invite a redundant upload) once BFP has actually decided,
 * and doesn't depend on however the applicant navigated back here.
 */
async function FsifPaymentSection({ applicationId }: { applicationId: string }) {
  const supabase = createServiceClient();
  const { data: latestRound } = await supabase
    .from("review_rounds")
    .select("id")
    .eq("application_id", applicationId)
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latestRound) return null;

  const { data: bfpReview } = await supabase
    .from("department_reviews")
    .select("decision")
    .eq("review_round_id", latestRound.id)
    .ilike("department", "BFP")
    .maybeSingle();
  if (!bfpReview || bfpReview.decision !== "pending") return null;

  return (
    <Card>
      <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Fire Safety Inspection Fee (FSIF)</p>
      <p style={{ fontSize: 12, color: "#6b7280" }}>
        The Bureau of Fire Protection (BFP) requires this fee paid directly to them, separately from this office. Already paid? Upload your receipt or screenshot below so BFP can verify it.
      </p>
      <AdditionalDocumentUpload
        applicationId={applicationId}
        defaultLabel="Fire Safety Inspection Fee (FSIF) — payment proof"
        purpose="fsif_payment_proof"
      />
    </Card>
  );
}

/**
 * Accepted Payment Methods (2026-08-19) -- shows the applicant which
 * channels this LGU actually accepts (and their details) right on the
 * status page, not just in the one-time SMS/email. For a non-cash
 * channel (GCash/Bank Transfer/Online -- none of which go through
 * MuniServe directly), the generic UploadCard below gets a payment-
 * specific prompt/default label instead of the generic "have a document
 * to add?" one, so it's obvious this is where a payment screenshot goes.
 */
async function PendingPaymentSection({ applicationId, lguId }: { applicationId: string; lguId: string }) {
  const supabase = createServiceClient();
  const lgu = await getLguDisplay(supabase, lguId);
  const channels = getEnabledPaymentChannels(lgu);
  const needsProof = anyChannelNeedsProofUpload(channels);

  return (
    <>
      <OpenInfoRequestsCard applicationId={applicationId} />
      {channels.length > 0 && (
        <Card>
          <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>How to pay</p>
          {channels.map((c, i) => (
            <p key={i} style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
              {c.longDetail}
            </p>
          ))}
        </Card>
      )}
      <UploadCard
        applicationId={applicationId}
        promptOverride={needsProof ? "Paid via GCash, Bank Transfer, or online? Upload your receipt or screenshot here so staff can confirm it." : undefined}
        defaultLabelOverride={needsProof ? "Payment receipt/screenshot" : undefined}
        purpose={needsProof ? "payment_proof" : undefined}
      />
    </>
  );
}

// fontFamily deliberately not overridden here -- see the identical fix and
// reasoning in ApplyPageClient.tsx (2026-08-20 audit finding).
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 640, margin: "32px auto", background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #c7ced8", color: "#1a1a2e" }}>
      {children}
    </div>
  );
}
function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: "1.25rem" }}>
      <p style={{ fontWeight: 500, fontSize: 16, margin: 0 }}>{title}</p>
      {sub && <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>{sub}</p>}
    </div>
  );
}
function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ border: "1px solid #c7ced8", borderRadius: 8, padding: 12, marginBottom: "1rem" }}>{children}</div>;
}
