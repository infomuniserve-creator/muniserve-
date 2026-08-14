import { getCurrentPlatformAdmin } from "@/lib/platform-admin";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../dashboard/sign-out-button";
import { createLguClient, viewAsLgu } from "./actions";

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
    .select("id, name, province, subdomain, display_name, created_at")
    .order("created_at", { ascending: false });

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
          Creates the LGU record, its own subdomain, and a first BPLO account (they&rsquo;ll get an email with a sign-in link).
          Departments are optional and can be added later. <strong>Fee rules aren&rsquo;t created here</strong> — those need the
          LGU&rsquo;s actual ordinance and are set up as a separate, dedicated step, never guessed.
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

          <div style={{ borderTop: "0.5px solid #e5e7eb", margin: "6px 0", paddingTop: 12 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
              First BPLO account
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <Field label="Name">
                <input name="bploName" type="text" placeholder="Juan Dela Cruz" style={inputStyle} />
              </Field>
              <Field label="Email *">
                <input name="bploEmail" type="email" required placeholder="bplo@malolos.gov.ph" style={inputStyle} />
              </Field>
            </div>
          </div>

          <button type="submit" style={submitBtnStyle}>Create client</button>
        </form>
      </div>

      <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "0.5px solid #e5e7eb" }}>
        <p style={{ fontWeight: 500, fontSize: 15, marginBottom: 4 }}>Clients ({(lgus ?? []).length})</p>
        <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 12 }}>
          &ldquo;View as&rdquo; lets you open a client&rsquo;s real dashboard for troubleshooting — you don&rsquo;t need a
          staff account of your own at their LGU, now or later. Every action you take there is attributed to
          &ldquo;{admin.full_name ?? "Platform Admin"} (Platform Admin)&rdquo;, not silently as that client&rsquo;s own staff.
        </p>
        {(lgus ?? []).length === 0 ? (
          <p style={{ fontSize: 13, color: "#6b7280" }}>No clients yet.</p>
        ) : (
          (lgus ?? []).map((lgu) => (
            <div key={lgu.id} style={{ padding: "12px 0", borderBottom: "0.5px solid #e5e7eb" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ fontSize: 13.5, fontWeight: 500, margin: 0 }}>{lgu.display_name ?? lgu.name}</p>
                  <p style={{ fontSize: 12, color: "#6b7280", margin: 0 }}>{lgu.name}{lgu.province ? `, ${lgu.province}` : ""}</p>
                </div>
                <span style={{ fontSize: 12, color: "#0C447C", fontWeight: 600 }}>
                  {lgu.subdomain ? `${lgu.subdomain}.muniserve.ph` : "no subdomain set"}
                </span>
              </div>
              <form action={viewAsLgu} style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <input type="hidden" name="lguId" value={lgu.id} />
                <select name="viewAs" style={{ ...inputStyle, height: 32, width: 240 }}>
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
            </div>
          ))
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
