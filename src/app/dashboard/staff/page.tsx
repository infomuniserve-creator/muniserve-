import { getCurrentStaff, officeIdentity } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import { Card, DashboardTopBar, EmptyState, MiniButton, PrimaryButton, Row, SectionHead, TonePill } from "../ui";
import { addStaffMember, setStaffActive } from "./actions";

const ROLE_LABEL: Record<string, string> = {
  bplo: "BPLO",
  treasury: "Treasury",
  mayor: "Mayor's Office",
  department: "Department",
};

/**
 * BPLO-only staff account management (CLAUDE.md section 7l) -- closes a
 * real operational gap: provisioning staff_users used to be a service-
 * role/admin-only task (migration 0002's own comment says so), meaning
 * onboarding a new department reviewer required direct database access.
 * A new account is added by email only -- auth_user_id stays null until
 * that person actually signs in with Google for the first time
 * (/auth/callback/route.ts claims it automatically by matching email).
 */
export default async function StaffPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "bplo") redirect("/dashboard");

  const office = officeIdentity(staff);
  const supabase = await createClient();
  const lgu = await getLguDisplay(supabase, staff.lgu_id);

  const { data: staffList } = await supabase
    .from("staff_users")
    .select("id, full_name, email, role, department, is_active, auth_user_id")
    .eq("lgu_id", staff.lgu_id)
    // Excludes a platform admin's "view as" proxy row (CLAUDE.md 7o
    // follow-up) -- it isn't real client staff and shouldn't clutter this
    // roster or be deactivatable from here.
    .eq("is_admin_proxy", false)
    .order("role", { ascending: true })
    .order("full_name", { ascending: true });

  const { data: departments } = await supabase
    .from("lgu_departments")
    .select("name, display_name")
    .eq("lgu_id", staff.lgu_id)
    .eq("is_active", true)
    .order("name", { ascending: true });

  return (
    <>
      <DashboardTopBar
        officeLabel={office.label}
        officeSub={`${lgu.name}, ${lgu.province}`}
        initials={office.initials}
        active="staff"
        applicationsHref={office.homeHref}
        staffHref="/dashboard/staff"
        settingsHref="/dashboard/settings"
        auditHref="/dashboard/audit"
        statsHref="/dashboard/stats"
        rightSlot={<SignOutButton />}
      />

      <div className="mb-9">
        <SectionHead title="Add a staff account" sub="They'll be able to sign in with Google once you add them here -- no password to set up." />
        <Card className="p-5">
          <form action={addStaffMember} className="flex flex-wrap items-end gap-3">
            <Field label="Full name">
              <input name="fullName" type="text" placeholder="Juan Dela Cruz" className="h-9 w-44 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint" />
            </Field>
            <Field label="Email *">
              <input name="email" type="email" required placeholder="juan@example.com" className="h-9 w-56 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint" />
            </Field>
            <Field label="Role *">
              <select name="role" required defaultValue="" className="h-9 w-40 rounded-xl border border-border-strong bg-surface px-2.5 text-[13px] text-ink">
                <option value="" disabled>Select one</option>
                <option value="bplo">BPLO</option>
                <option value="treasury">Treasury</option>
                <option value="mayor">Mayor&rsquo;s Office</option>
                <option value="department">Department</option>
              </select>
            </Field>
            <Field label="Department (if role is Department)">
              <select name="department" defaultValue="" className="h-9 w-48 rounded-xl border border-border-strong bg-surface px-2.5 text-[13px] text-ink">
                <option value="">— not applicable —</option>
                {(departments ?? []).map((d) => (
                  <option key={d.name} value={d.name}>{d.display_name ?? d.name}</option>
                ))}
              </select>
            </Field>
            <PrimaryButton type="submit">Add staff</PrimaryButton>
          </form>
        </Card>
      </div>

      <div>
        <SectionHead title={`All staff at ${lgu.name}, ${lgu.province}`} />
        {(staffList ?? []).length === 0 ? (
          <EmptyState>No staff accounts yet.</EmptyState>
        ) : (
          <Card>
            {(staffList ?? []).map((s) => (
              <Row key={s.id}>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-bold text-ink">{s.full_name || "(name not set)"}</p>
                  <p className="text-[12px] text-ink-soft">{s.email}</p>
                </div>
                <TonePill label={s.role === "department" ? (s.department ?? "Department") : ROLE_LABEL[s.role]} tone="info" />
                {!s.auth_user_id && <TonePill label="Not yet signed in" tone="neutral" />}
                <TonePill label={s.is_active ? "Active" : "Inactive"} tone={s.is_active ? "good" : "bad"} />
                <form action={setStaffActive}>
                  <input type="hidden" name="staffId" value={s.id} />
                  <input type="hidden" name="isActive" value={String(!s.is_active)} />
                  <MiniButton type="submit" tone={s.is_active ? "bad" : "good"}>{s.is_active ? "Deactivate" : "Activate"}</MiniButton>
                </form>
              </Row>
            ))}
          </Card>
        )}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-bold text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
