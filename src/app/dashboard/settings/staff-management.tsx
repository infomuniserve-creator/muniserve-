import { Card, EmptyState, MiniButton, PrimaryButton, Row, SectionHead, TonePill } from "../ui";
import { addStaffMember, setStaffActive, updateStaffPhone } from "./staff-actions";

const ROLE_LABEL: Record<string, string> = {
  bplo: "BPLO",
  treasury: "Treasury",
  mayor: "Mayor's Office",
  department: "Department",
};

type StaffRow = { id: string; full_name: string | null; email: string; phone: string | null; role: string; department: string | null; is_active: boolean; auth_user_id: string | null };
type DepartmentOption = { name: string; display_name: string | null };

/**
 * "Add/Remove Staff" -- the first section on /dashboard/settings
 * (2026-08-15), moved off its own top-nav "Staff" tab so the tab bar only
 * lists primary day-to-day sections (Applications, Businesses, Audit
 * Trail, Performance Stats); staff account management is an occasional
 * admin task, same category as the rest of this page. A plain server
 * component, not a client one -- every control here is already a server
 * action form, nothing needs client-side state.
 */
export function StaffManagementSection({ lguName, lguProvince, staffList, departments }: { lguName: string; lguProvince: string | null; staffList: StaffRow[]; departments: DepartmentOption[] }) {
  return (
    <div className="mb-9">
      <SectionHead title="Add/Remove Staff" sub="They'll be able to sign in with Google once you add them here -- no password to set up." />
      <Card className="mb-4 p-5">
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
              {departments.map((d) => (
                <option key={d.name} value={d.name}>{d.display_name ?? d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Mobile (for SMS)">
            <input name="phone" type="tel" placeholder="09XXXXXXXXX" className="h-9 w-36 rounded-xl border border-border-strong bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint" />
          </Field>
          <PrimaryButton type="submit">Add staff</PrimaryButton>
        </form>
      </Card>

      <SectionHead title={`All staff at ${lguName}${lguProvince ? `, ${lguProvince}` : ""}`} />
      {staffList.length === 0 ? (
        <EmptyState>No staff accounts yet.</EmptyState>
      ) : (
        <Card>
          {staffList.map((s) => (
            <Row key={s.id}>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-bold text-ink">{s.full_name || "(name not set)"}</p>
                <p className="text-[12px] text-ink-soft">{s.email}</p>
              </div>
              <TonePill label={s.role === "department" ? (s.department ?? "Department") : ROLE_LABEL[s.role]} tone="info" />
              {!s.auth_user_id && <TonePill label="Not yet signed in" tone="neutral" />}
              <TonePill label={s.is_active ? "Active" : "Inactive"} tone={s.is_active ? "good" : "bad"} />
              <form action={updateStaffPhone} className="flex items-center gap-1.5">
                <input type="hidden" name="staffId" value={s.id} />
                <input
                  name="phone"
                  type="tel"
                  defaultValue={s.phone ?? ""}
                  placeholder="No SMS number"
                  className="h-8 w-32 rounded-lg border border-border-strong bg-surface px-2 text-[12px] text-ink placeholder:text-ink-faint"
                />
                <MiniButton type="submit" tone="neutral">Save</MiniButton>
              </form>
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
