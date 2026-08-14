import { getCurrentStaff, officeIdentity } from "@/lib/staff";
import { getLguDisplay } from "@/lib/lgu";
import { fetchAllRows } from "@/lib/db-pagination";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SignOutButton } from "../../sign-out-button";
import { DashboardTopBar } from "../../ui";
import { BusinessesSubNav } from "../sub-nav";
import { PermitHistoryTable, type PermitRow } from "./permit-history-table";

export default async function PermitHistoryPage() {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");

  const office = officeIdentity(staff);
  const supabase = await createClient();
  const lgu = await getLguDisplay(supabase, staff.lgu_id);
  const raw = await fetchAllRows<Record<string, unknown>>((offset, limit) =>
    supabase
      .from("permit_history")
      .select("id, year, permit_no, business_name, owner_name, barangay, application_type, category, description, owner_type, gender, amount_paid, capital, gross_sales, pay_frequency, legacy_license_no", { count: "exact" })
      .eq("lgu_id", staff.lgu_id)
      .range(offset, offset + limit - 1)
  );

  const rows: PermitRow[] = raw.map((r) => ({
    id: r.id as string,
    year: r.year as number,
    permitNo: (r.permit_no as string | null) ?? null,
    businessName: r.business_name as string,
    ownerName: (r.owner_name as string | null) ?? null,
    barangay: (r.barangay as string | null) ?? null,
    applicationType: (r.application_type as "new" | "renewal" | null) ?? null,
    category: (r.category as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    ownerType: (r.owner_type as string | null) ?? null,
    gender: (r.gender as "Male" | "Female" | null) ?? null,
    amountPaid: (r.amount_paid as number | null) ?? null,
    capital: (r.capital as number | null) ?? null,
    grossSales: (r.gross_sales as number | null) ?? null,
    payFrequency: (r.pay_frequency as string | null) ?? null,
    legacyLicenseNo: (r.legacy_license_no as string | null) ?? null,
  }));

  return (
    <>
      <DashboardTopBar
        officeLabel={office.label}
        officeSub={`${lgu.name}, ${lgu.province}`}
        initials={office.initials}
        active="businesses"
        applicationsHref={office.homeHref}
        staffHref={staff.role === "bplo" ? "/dashboard/staff" : undefined}
        settingsHref={staff.role === "bplo" ? "/dashboard/settings" : undefined}
        rightSlot={<SignOutButton />}
      />
      <BusinessesSubNav active="history" />
      <PermitHistoryTable rows={rows} />
    </>
  );
}
