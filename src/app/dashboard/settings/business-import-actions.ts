"use server";

import { requireUnpausedStaff } from "@/lib/staff";
import { actorLabelFor, logAuditEvent } from "@/lib/audit-log";
import { getLbtCategoryOptions } from "@/lib/lbt-categories";
import { parseBusinessImportCsv, summarizeBusinessRow, type ParsedBusinessRow } from "@/lib/business-import";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Self-service legacy business roster import (2026-08-18) -- see
 * business-import.ts for the parsing/validation and the reasoning behind
 * this feature. Both actions here are BPLO-only.
 */

export type BusinessImportPreview = { ok: true; summaries: string[]; warnings: string[]; rowCount: number; claimCount: number } | { ok: false; errors: string[] };

/** Parse-only, no writes. */
export async function previewBusinessImport(csvText: string): Promise<BusinessImportPreview> {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");

  const result = parseBusinessImportCsv(csvText);
  if (!result.ok) return { ok: false, errors: result.errors };
  return {
    ok: true,
    summaries: result.rows.map(summarizeBusinessRow),
    warnings: result.warnings,
    rowCount: result.rows.length,
    claimCount: result.rows.filter((r) => r.phone).length,
  };
}

export type BusinessImportOutcome =
  | { ok: true; importedCount: number; skippedCount: number; claimedCount: number; warnings: string[] }
  | { ok: false; errors: string[] };

/**
 * Re-parses the file server-side (never trusts the client's own preview
 * state, same reasoning as every other CSV import in this project) and
 * batches its writes rather than one row at a time -- a real LGU's
 * roster can be 1,000+ rows (San Miguel's own original import was
 * 1,177), and the owner-lookup/insert step in particular would be
 * needlessly slow done per-row. Insert-only: never deletes or modifies
 * an existing business, so re-uploading a file that includes
 * previously-imported rows is a safe no-op for those specific rows (they
 * get skipped as duplicates by legacy_license_no, which is globally
 * unique across every LGU -- not just this one).
 */
export async function publishBusinessImport(csvText: string, taxYear: number): Promise<BusinessImportOutcome> {
  const staff = await requireUnpausedStaff();
  if (!staff || staff.role !== "bplo") throw new Error("Not authorized");
  if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100) throw new Error("Invalid tax year");

  const result = parseBusinessImportCsv(csvText);
  if (!result.ok) return { ok: false, errors: result.errors };
  const warnings = [...result.warnings];

  const supabase = await createClient();

  // lbt_category is only known to be valid once we know which LGU this
  // is -- business-import.ts's own parse step can't check this, since it
  // has no database access. Anything that doesn't match one of this
  // LGU's own active LBT schedule codes imports with a blank category
  // rather than failing the row outright (matches the existing "missing
  // LBT category" gate elsewhere in this app -- BPLO can set it later
  // from the Business Registry, same as any other business with this gap).
  const validLbtCategories = new Set((await getLbtCategoryOptions(staff.lgu_id)).map((o) => o.value));
  for (const row of result.rows) {
    if (row.lbtCategory && !validLbtCategories.has(row.lbtCategory)) {
      warnings.push(`"${row.businessName}": lbt_category "${row.lbtCategory}" doesn't match any of this LGU's configured LBT schedules -- imported without one. Set it in the Business Registry before this business can enter department review.`);
      row.lbtCategory = null;
    }
  }

  // legacy_license_no is globally unique (not just per-LGU) -- skip any
  // row that collides with a business that already exists anywhere,
  // rather than letting the whole file fail on one duplicate. This is
  // also what makes a partial re-upload safe: rows already imported
  // previously are silently skipped, not re-inserted or overwritten.
  const licenseNos = result.rows.map((r) => r.legacyLicenseNo).filter((v): v is string => v != null);
  const existingLicenseNos = new Set<string>();
  if (licenseNos.length > 0) {
    const { data: existing, error } = await supabase.from("businesses").select("legacy_license_no").in("legacy_license_no", licenseNos);
    if (error) return { ok: false, errors: [error.message] };
    for (const e of existing ?? []) if (e.legacy_license_no) existingLicenseNos.add(e.legacy_license_no);
  }

  const importableRows: ParsedBusinessRow[] = [];
  let skippedCount = 0;
  for (const row of result.rows) {
    if (row.legacyLicenseNo && existingLicenseNos.has(row.legacyLicenseNo)) {
      skippedCount++;
      continue;
    }
    importableRows.push(row);
  }

  // Resolve an owner for every row that has a phone -- find existing
  // owners first (one bulk lookup), then create exactly one new owner
  // per still-unmatched phone (not one per business -- two businesses in
  // the same file sharing a phone number is a real case, rule #3, "one
  // owner can have multiple businesses").
  const phones = [...new Set(importableRows.map((r) => r.phone).filter((p): p is string => p != null))];
  const ownerIdByPhone = new Map<string, string>();
  if (phones.length > 0) {
    const { data: existingOwners, error: ownerFetchError } = await supabase.from("owners").select("id, phone").in("phone", phones);
    if (ownerFetchError) return { ok: false, errors: [ownerFetchError.message] };
    for (const o of existingOwners ?? []) {
      if (o.phone) ownerIdByPhone.set(o.phone, o.id);
    }

    const newOwnerPhones = phones.filter((p) => !ownerIdByPhone.has(p));
    if (newOwnerPhones.length > 0) {
      // Client-generated ids, no .select() after insert -- owners' own
      // SELECT policy only allows staff to see an owner already linked
      // to one of their businesses (migration 0023), and a brand-new
      // owner isn't linked to anything at the moment it's created. Same
      // pattern already established in businesses/actions.ts's
      // claimLegacyBusiness/startWalkInApplication.
      const newOwnerRows = newOwnerPhones.map((phone) => {
        const row = importableRows.find((r) => r.phone === phone)!;
        return { id: crypto.randomUUID(), full_name: row.legacyOwnerName || phone, phone, email: row.email || null, claimed_at: new Date().toISOString() };
      });
      const { error: ownerInsertError } = await supabase.from("owners").insert(newOwnerRows);
      if (ownerInsertError) return { ok: false, errors: [`Could not create owner accounts: ${ownerInsertError.message}`] };
      for (const o of newOwnerRows) ownerIdByPhone.set(o.phone, o.id);
    }
  }

  const businessRows = importableRows.map((row) => {
    const ownerId = row.phone ? (ownerIdByPhone.get(row.phone) ?? null) : null;
    return {
      lgu_id: staff.lgu_id,
      business_name: row.businessName,
      legacy_license_no: row.legacyLicenseNo,
      barangay: row.barangay,
      address: row.address,
      nature_of_business: row.natureOfBusiness,
      lbt_category: row.lbtCategory,
      organization_type: row.organizationType,
      tin: row.tin,
      legacy_owner_name: row.legacyOwnerName,
      owner_id: ownerId,
      is_legacy_unclaimed: ownerId == null,
      is_active: true,
      gross_sales_history: row.grossSales != null ? { [String(taxYear)]: row.grossSales } : null,
    };
  });

  let importedCount = 0;
  if (businessRows.length > 0) {
    const { error: insertError, count } = await supabase.from("businesses").insert(businessRows, { count: "exact" });
    if (insertError) return { ok: false, errors: [`Nothing was changed -- import failed: ${insertError.message}`] };
    importedCount = count ?? businessRows.length;
  }

  const claimedCount = businessRows.filter((b) => b.owner_id != null).length;

  await logAuditEvent(supabase, {
    lguId: staff.lgu_id,
    actorRole: staff.role,
    actorLabel: actorLabelFor(staff),
    action: "businesses_imported",
    summary: `Imported ${importedCount} business${importedCount === 1 ? "" : "es"} via CSV (${claimedCount} claimed immediately, ${skippedCount} skipped as already on file)`,
    details: { importedCount, claimedCount, skippedCount, taxYear },
  });

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/businesses");
  return { ok: true, importedCount, skippedCount, claimedCount, warnings };
}
