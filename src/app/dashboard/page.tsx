import { getCurrentStaff } from "@/lib/staff";
import { redirect } from "next/navigation";
import { SignOutButton } from "./sign-out-button";

/** Landing spot after login. Routes each role to its dashboard per CLAUDE.md section 9's build order. */
export default async function DashboardRouterPage() {
  const staff = await getCurrentStaff();

  if (!staff) {
    return (
      <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#f4f6fb" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 40, maxWidth: 420, textAlign: "center", border: "0.5px solid #e5e7eb" }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Not provisioned</h1>
          <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
            You&rsquo;re signed in with Google, but this account isn&rsquo;t set up as MuniServe staff yet
            (or has been deactivated). Ask BPLO to add you to <code>staff_users</code>.
          </p>
          <SignOutButton />
        </div>
      </div>
    );
  }

  if (staff.role === "bplo") redirect("/dashboard/bplo");
  if (staff.role === "mayor") redirect("/dashboard/mayor");
  if (staff.role === "department") redirect("/dashboard/department");
  if (staff.role === "treasury") redirect("/dashboard/treasury");

  redirect("/login");
}
