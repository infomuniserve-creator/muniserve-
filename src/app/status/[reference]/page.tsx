import { getApplicantOwnerId } from "@/lib/applicant-session";
import { createServiceClient } from "@/lib/supabase/service";
import { notFound } from "next/navigation";

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
      "id, status, submitted_at, business:businesses(business_name, owner_id)"
    )
    .eq("reference_number", reference)
    .maybeSingle();

  if (!application) notFound();

  const business = application.business as unknown as { business_name: string; owner_id: string | null } | null;

  if (!ownerId || !business || business.owner_id !== ownerId) {
    return (
      <Shell>
        <Head title="Can't verify this application here" sub={`Reference ${reference}`} />
        <Card>
          <p style={{ fontSize: 13 }}>
            We can&rsquo;t confirm this application belongs to you in this browser. Please check its status from the
            device and browser you used to submit it, or contact the BPLO office for help.
          </p>
        </Card>
      </Shell>
    );
  }

  // Collapse the two payment-related statuses into one visual stage.
  const visualStages = [
    { key: "pending_bplo_initial", label: "Initial review" },
    { key: "pending_dept_review", label: "Department review" },
    { key: "assessment", label: "Assessment and payment" },
    { key: "pending_mayor", label: "Mayor's signature" },
    { key: "released", label: "Released" },
  ];
  const statusToVisualKey: Record<string, string> = {
    pending_bplo_initial: "pending_bplo_initial",
    pending_dept_review: "pending_dept_review",
    pending_bplo_assessment: "assessment",
    pending_payment: "assessment",
    pending_mayor: "pending_mayor",
    released: "released",
  };
  const currentKey = statusToVisualKey[application.status] ?? null;
  const currentIdx = currentKey ? visualStages.findIndex((s) => s.key === currentKey) : -1;

  if (application.status === "returned_to_applicant") {
    return (
      <Shell>
        <Head title={business.business_name} sub={`Reference ${reference}`} />
        <Card>
          <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Returned for corrections</p>
          <p style={{ fontSize: 12, color: "#6b7280" }}>
            BPLO returned your application during initial review. Please contact the BPLO office for details on what
            needs to be corrected before resubmitting.
          </p>
        </Card>
      </Shell>
    );
  }

  if (application.status === "rejected") {
    return (
      <Shell>
        <Head title={business.business_name} sub={`Reference ${reference}`} />
        <Card>
          <p style={{ fontSize: 13, fontWeight: 500 }}>Application rejected</p>
          <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Please contact the BPLO office for details.</p>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell>
      <Head title={business.business_name} sub={`Reference ${reference}`} />
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
      {currentKey === "pending_dept_review" && <DeptReviewNote applicationId={application.id} />}
    </Shell>
  );
}

async function DeptReviewNote({ applicationId }: { applicationId: string }) {
  const supabase = createServiceClient();
  const { data: round } = await supabase
    .from("review_rounds")
    .select("id")
    .eq("application_id", applicationId)
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!round) return null;

  const { data: reviews } = await supabase
    .from("department_reviews")
    .select("department, decision, notes")
    .eq("review_round_id", round.id)
    .in("decision", ["rejected", "request_more_info"]);

  if (!reviews || reviews.length === 0) return null;

  return (
    <Card>
      <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
        {reviews.map((r) => r.department).join(", ")} need{reviews.length === 1 ? "s" : ""} more information
      </p>
      {reviews.map((r) => r.notes && (
        <p key={r.department} style={{ fontSize: 12, color: "#6b7280" }}>{r.department}: {r.notes}</p>
      ))}
      <p style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
        Please contact the BPLO office to submit corrections. Online resubmission isn&rsquo;t available yet.
      </p>
    </Card>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 640, margin: "32px auto", background: "#fff", borderRadius: 16, padding: 24, border: "0.5px solid #e5e7eb", fontFamily: "-apple-system, 'Segoe UI', Arial, sans-serif", color: "#1a1a2e" }}>
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
  return <div style={{ border: "0.5px solid #e5e7eb", borderRadius: 8, padding: 12, marginBottom: "1rem" }}>{children}</div>;
}
