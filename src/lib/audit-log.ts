import type { CurrentStaff } from "@/lib/staff";
import type { SupabaseClient } from "@supabase/supabase-js";

const ROLE_LABEL: Record<string, string> = {
  bplo: "BPLO",
  treasury: "Treasury",
  mayor: "Mayor's Office",
  department: "Department",
};

/** "Juan Dela Cruz (BPLO)" / "Juan Dela Cruz (MENRO Department)" / "(unnamed BPLO staff)" if full_name was never set. */
export function actorLabelFor(staff: CurrentStaff): string {
  const roleLabel = staff.role === "department" ? `${staff.department ?? "Department"} Department` : ROLE_LABEL[staff.role];
  return `${staff.full_name || "(unnamed staff)"} (${roleLabel})`;
}

export type AuditAction =
  | "application_submitted"
  | "walkin_application_started"
  | "initial_review_approved"
  | "initial_review_returned"
  | "department_decision"
  | "assessment_finalized"
  | "payment_recorded"
  | "permit_printed"
  | "permit_signed"
  | "permit_released"
  | "staff_added"
  | "staff_activated"
  | "staff_deactivated"
  | "lgu_client_created"
  | "lgu_paused"
  | "lgu_resumed";

/**
 * Appends one row to the audit_log table (CLAUDE.md 7o follow-up) --
 * best-effort by design, same reasoning as src/lib/notifications.ts: the
 * real state change (an application's status, a payment row, a signed
 * permit) has already succeeded by the time this is called, and a logging
 * failure must never roll back or block that. Errors are swallowed and
 * console.error'd, never thrown.
 *
 * Takes the caller's own client (staff's RLS-scoped session for staff
 * actions -- migration 0022's insert policy covers any role at their own
 * LGU -- or the platform admin's session / service-role for system
 * events like a new applicant submission).
 */
export async function logAuditEvent(
  supabase: SupabaseClient,
  event: {
    lguId: string;
    applicationId?: string | null;
    actorRole?: string | null;
    actorLabel?: string | null;
    action: AuditAction;
    summary: string;
    details?: Record<string, unknown> | null;
  }
): Promise<void> {
  try {
    const { error } = await supabase.from("audit_log").insert({
      lgu_id: event.lguId,
      application_id: event.applicationId ?? null,
      actor_role: event.actorRole ?? null,
      actor_label: event.actorLabel ?? null,
      action: event.action,
      summary: event.summary,
      details: event.details ?? null,
    });
    if (error) console.error("logAuditEvent failed", event.action, error);
  } catch (err) {
    console.error("logAuditEvent threw", event.action, err);
  }
}
