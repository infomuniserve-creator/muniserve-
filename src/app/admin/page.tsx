import { getCurrentPlatformAdmin } from "@/lib/platform-admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../dashboard/sign-out-button";
import { createLguClient, deleteLguClient, setLguPaused, viewAsLgu } from "./actions";

/**
 * Platform-admin dashboard (CLAUDE.md section 7o) -- the "agency owner"
 * login the project owner asked for directly. Lists every LGU client and
 * lets a platform admin onboard a new one: creates the lgus row (with
 * its own subdomain, see src/lib/lgu.ts's resolveLguId), any departments
 * named, and a bootstrap BPLO account for that LGU, then emails that
 * BPLO a sign-in link -- the same self-service pattern as
 * /dashboard/staff, one level up.
 *
 * Deliberately plain inline styles (not the dashboard's Tailwind
 * component library, ui.tsx) -- this is its own route segment, not
 * nested under /dashboard, matching the same self-contained style
 * already used by apply/login/status/verify.
 */
export default async function AdminPage() {
  const admin = await getCurrentPlatformAdmin();
  if (!admin) redirect("/login");

  const supabase = await createClient();
  const { data: lgus } = await supabase
    .from("lgus")
    .select("id, name, province, subdomain, display_name, is_paused, created_at")
    .order("created_at", { ascending: false });
  const lguList = lgus ?? [];

  // Powers the per-LGU "View as" department options below -- fetched once
  // for every client rather than per-row, then grouped in JS.
  const { data: allDepartments } = await supabase
    .from("lgu_departments")
    .select("lgu_id, name, display_name")
    .eq("is_active", true)
    .order("name", { ascending: true });
  const departmentsByLgu = new Map<string, { name: string; display_name: string | null }[]>();
  for (const d of allDepartments ?? []) {
    const list = departmentsByLgu.get(d.lgu_id) ?? [];
    list.push({ name: d.name, display_name: d.display_name });
    departmentsByLgu.set(d.lgu_id, list);
  }

  // Tells each row whether Delete is actually possible -- deleteLguClient
  // enforces this same zero-applications-and-zero-businesses rule
  // server-side, this is just so the UI can explain why the button isn't
  // there instead of the admin only finding out after typing the name in.
  const recordCounts = await Promise.all(
    lguList.map(async (lgu) => {
      const [{ count: appCount }, { count: bizCount }] = await Promise.all([
        supabase.from("applications").select("id", { count: "exact", head: true }).eq("lgu_id", lgu.id),
        supabase.from("businesses").select("id", { count: "exact", head: true }).eq("lgu_id", lgu.id),
      ]);
      return { lguId: lgu.id, appCount: appCount ?? 0, bizCount: bizCount ?? 0 };
    })
  );
  const countsByLgu = new Map(recordCounts.map((c) => [c.lguId, c]));

  return (
    <div style={{ maxWidth: 760, margin: "32px auto", padding: "0 16px", fontFamily: "-apple-system, 'Segoe UI', Arial, sans-serif", color: "#1a1a2e" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <p style={{ fontWeight: 600, fontSize: 20, margin: 0 }}>MuniServe — Agency Admin</p>
          <p style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>Signed in as {admin.full_name ?? admin.email}</p>
        </div>
        <SignOutButton />
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "0.5px solid #e5e7eb", marginBottom: 24 }}>
        <p style={{ fontWeight: 500, fontSize: 15, marginBottom: 4 }}>Add a new client</p>
        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
          Creates the LGU record and its own subdomain. Departments, barangays, and the first BPLO account are all optional and
          can be added later — leave the BPLO email blank if you don&rsquo;t have it yet, or want to test-drive the account
          first via &ldquo;View as&rdquo; below. Without a barangay list, their public application form shows a free-text
          field instead of a dropdown until one is set. Nature-of-business options aren&rsquo;t collected here — every new
          client starts with a sensible generic list, editable later if they need their own. <strong>Fee rules aren&rsquo;t
          created here</strong> — those need the LGU&rsquo;s actual ordinance and are set up as a separate, dedicated step,
          never guessed.
        </p>
        <form action={createLguClient} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <Field label="LGU name *">
              <input name="name" type="text" required placeholder="Malolos" style={inputStyle} />
            </Field>
            <Field label="Province">
              <input name="province" type="text" placeholder="Bulacan" style={inputStyle} />
            </Field>
          </div>
          <Field label="Subdomain * (lowercase letters, numbers, hyphens only)">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input name="subdomain" type="text" required placeholder="malolos" style={{ ...inputStyle, flex: 1 }} />
              <span style={{ fontSize: 13, color: "#6b7280" }}>.muniserve.ph</span>
            </div>
          </Field>
          <Field label="Full display name (letterhead) — e.g. &ldquo;City of Malolos&rdquo;">
            <input name="displayName" type="text" placeholder="City of Malolos" style={inputStyle} />
          </Field>
          <Field label="BPLO office name (letterhead)">
            <input name="bploOfficeName" type="text" placeholder="Office of the City Business Permit and Licensing Officer" style={inputStyle} />
          </Field>
          <Field label="Departments (comma-separated, optional)">
            <input name="departments" type="text" placeholder="Zoning, Fire, MENRO, Engineering" style={inputStyle} />
          </Field>
          <Field label="Barangays (comma-separated, optional) — leave blank to use free text until set">
            <input name="barangays" type="text" placeholder="Barangay 1, Barangay 2, Poblacion, ..." style={inputStyle} />
          </Field>

          <div style={{ borderTop: "0.5px solid #e5e7eb", margin: "6px 0", paddingTop: 12 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
              First BPLO account (optional)
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <Field label="Name">
                <input name="bploName" type="text" placeholder="Juan Dela Cruz" style={inputStyle} />
              </Field>
              <Field label="Email — leave blank to add later">
                <input name="bploEmail" type="email" placeholder="bplo@malolos.gov.ph" style={inputStyle} />
              </Field>
            </div>
          </div>

          <button type="submit" style={submitBtnStyle}>Create client</button>
        </form>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "0.5px solid #e5e7eb" }}>
        <p style={{ fontWeight: 500, fontSize: 15, marginBottom: 4 }}>Clients ({lguList.length})</p>
        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
          &ldquo;View as&rdquo; lets you open a client&rsquo;s real dashboard for troubleshooting — you don&rsquo;t need a
          staff account of your own at their LGU, now or later. Every action you take there is attributed to
          &ldquo;{admin.full_name ?? "Platform Admin"} (Platform Admin)&rdquo;, not silently as that client&rsquo;s own staff.
          <strong> Pause</strong> blocks that client&rsquo;s own staff from signing in (e.g. non-payment) without touching any
          of their data — you can still &ldquo;View as&rdquo; a paused client yourself.
        </p>
        {lguList.length === 0 ? (
          <p style={{ fontSize: 13, color: "#6b7280" }}>No clients yet.</p>
        ) : (
          lguList.map((lgu) => {
            const counts = countsByLgu.get(lgu.id) ?? { appCount: 0, bizCount: 0 };
            const canDelete = counts.appCount === 0 && counts.bizCount === 0;
            return (
              <div key={lgu.id} style={{ padding: "14px 0", borderBottom: "0.5px solid #e5e7eb" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ fontSize: 13.5, fontWeight: 500, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                      {lgu.display_name ?? lgu.name}
                      {lgu.is_paused && (
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#92400e", background: "#fef3c7", borderRadius: 999, padding: "2px 8px" }}>
                          ⏸ PAUSED
                        </span>
                      )}
                    </p>
                    <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>{lgu.name}{lgu.province ? `, ${lgu.province}` : ""}</p>
                  </div>
                  <span style={{ fontSize: 12, color: "#0C447C", fontWeight: 600 }}>
                    {lgu.subdomain ? `${lgu.subdomain}.muniserve.ph` : "no subdomain set"}
                  </span>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
                  <form action={viewAsLgu} style={{ display: "flex", gap: 8 }}>
                    <input type="hidden" name="lguId" value={lgu.id} />
                    <select name="viewAs" style={{ ...inputStyle, height: 32, width: 220 }}>
                      <option value="bplo">View as BPLO</option>
                      <option value="treasury">View as Treasury</option>
                      <option value="mayor">View as Mayor&rsquo;s Office</option>
                      {(departmentsByLgu.get(lgu.id) ?? []).map((d) => (
                        <option key={d.name} value={`department:${d.name}`}>
                          View as {d.display_name ?? d.name} (Dept.)
                        </option>
                      ))}
                    </select>
                    <button type="submit" style={{ ...submitBtnStyle, padding: "6px 14px", fontSize: 12 }}>
                      Go →
                    </button>
                  </form>

                  <form action={setLguPaused}>
                    <input type="hidden" name="lguId" value={lgu.id} />
                    <input type="hidden" name="paused" value={String(!lgu.is_paused)} />
                    <button
                      type="submit"
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "6px 14px",
                        borderRadius: 8,
                        border: lgu.is_paused ? "1px solid #15803d" : "1px solid #b45309",
                        background: "#fff",
                        color: lgu.is_paused ? "#15803d" : "#b45309",
                        cursor: "pointer",
                      }}
                    >
                      {lgu.is_paused ? "Resume" : "Pause"}
                    </button>
                  </form>
                </div>

                <div style={{ marginTop: 10, borderTop: "0.5px dashed #e5e7eb", paddingTop: 10 }}>
                  {canDelete ? (
                    <form action={deleteLguClient} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                      <input type="hidden" name="lguId" value={lgu.id} />
                      <span style={{ fontSize: 11, color: "#6b7280" }}>
                        No applications or businesses on file — safe to delete. Type <strong>{lgu.name}</strong> to confirm:
                      </span>
                      <input name="confirmName" type="text" placeholder={lgu.name} style={{ ...inputStyle, height: 28, width: 160, fontSize: 12 }} />
                      <button type="submit" style={{ fontSize: 11.5, fontWeight: 600, padding: "5px 12px", borderRadius: 8, border: "1px solid #b91c1c", background: "#fff", color: "#b91c1c", cursor: "pointer" }}>
                        Delete permanently
                      </button>
                    </form>
                  ) : (
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>
                      Can&rsquo;t delete — {counts.appCount} application(s) and {counts.bizCount} business(es) on file. Use Pause instead.
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <p style={{ fontSize: 11, color: "#6b7280", marginTop: 16 }}>
        After creating a client, add their subdomain (<code>{"<subdomain>"}.muniserve.ph</code>) as a domain in Vercel and point
        its DNS at GoDaddy the same way portal.muniserve.ph was set up — that&rsquo;s what makes their own applicant-facing form
        show up with their own branding. Their staff can sign in at the shared /login right away, before that step is done.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1 }}>
      <label style={{ display: "block", fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = { width: "100%", height: 36, border: "0.5px solid #e5e7eb", borderRadius: 8, padding: "0 10px", fontSize: 13, background: "#fff", color: "#1a1a2e" };
const submitBtnStyle: React.CSSProperties = { alignSelf: "flex-start", fontSize: 13, fontWeight: 600, padding: "8px 16px", borderRadius: 8, border: "1px solid #0C447C", background: "#0C447C", color: "#fff", cursor: "pointer" };
