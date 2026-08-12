import { getCurrentStaff } from "@/lib/staff";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../sign-out-button";
import { Card, EmptyState, SectionLabel, StatCard, StatGrid, TopBar, colors } from "../ui";
import { recordPayment } from "./actions";

/**
 * Treasury dashboard -- CLAUDE.md section 10 flagged this as "not yet
 * mocked up... likely a short one: view assessed amount, record payment
 * method/OR number, done." That's exactly what this is. Rule #7: Treasury
 * confirms payment and records an OR number, never adjusts the fee
 * amount -- there's deliberately no way to edit anything here but those
 * two fields plus the amount actually received.
 */
export default async function TreasuryDashboardPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  if (staff.role !== "treasury") redirect("/dashboard");

  const supabase = await createClient();
  const { data: apps } = await supabase
    .from("applications")
    .select(
      "id, application_type, business:businesses(business_name, legacy_owner_name, owner:owners(full_name))"
    )
    .eq("lgu_id", staff.lgu_id)
    .eq("status", "pending_payment")
    .order("submitted_at", { ascending: true });

  const rows = apps ?? [];

  function ownerName(a: (typeof rows)[number]): string {
    const biz = a.business as unknown as { legacy_owner_name: string | null; owner: { full_name: string } | null } | null;
    return biz?.owner?.full_name ?? biz?.legacy_owner_name ?? "Unknown applicant";
  }
  function businessName(a: (typeof rows)[number]): string {
    const biz = a.business as unknown as { business_name: string } | null;
    return biz?.business_name ?? "(business record missing)";
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", background: colors.surface2, borderRadius: 16, padding: 24, border: `0.5px solid ${colors.border}` }}>
      <TopBar title="Treasury office" subtitle="San Miguel, Bulacan" initials="TR" bg={colors.proBg} fg={colors.proText} rightSlot={<SignOutButton />} />

      <StatGrid>
        <StatCard label="Awaiting payment" value={rows.length} />
      </StatGrid>

      <SectionLabel>Awaiting payment</SectionLabel>
      {rows.length === 0 ? (
        <Card><EmptyState>Nothing waiting on payment right now.</EmptyState></Card>
      ) : (
        rows.map((a) => (
          <Card key={a.id} style={{ padding: 12, marginBottom: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 500, margin: "0 0 4px" }}>{businessName(a)}</p>
            <p style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 10 }}>
              Owner: {ownerName(a)} · {a.application_type === "new" ? "New" : "Renewal"}
            </p>
            <p style={{ fontSize: 12, color: colors.textSecondary, marginBottom: 10 }}>
              Fee computation engine isn&rsquo;t built yet (build order step 7) — enter the amount actually collected manually for now.
            </p>
            <form action={recordPayment} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <input type="hidden" name="applicationId" value={a.id} />
              <input name="amount" type="number" step="0.01" placeholder="Amount (₱)" required style={inputStyle} />
              <select name="method" style={inputStyle} defaultValue="Cash">
                <option>Cash</option>
                <option>GCash</option>
                <option>Bank Transfer</option>
                <option>Check</option>
              </select>
              <input name="orNumber" placeholder="OR number" required style={inputStyle} />
              <button type="submit" style={actBtnStyle}>Record payment</button>
            </form>
          </Card>
        ))
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = { height: 32, border: `0.5px solid ${colors.border}`, borderRadius: 8, padding: "0 8px", fontSize: 12, width: 140 };
const actBtnStyle: React.CSSProperties = { fontSize: 12, padding: "6px 10px", borderRadius: 8, border: `0.5px solid ${colors.border}`, background: "#fff", cursor: "pointer" };
