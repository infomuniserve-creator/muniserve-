// One-time import for permit_history (migration 0011).
//
// Run with: node supabase/seed/import_permit_history.mjs
//
// This is a Node + service-role script rather than a pasted SQL file like
// the other seed scripts in this folder -- at 13,548 rows the resulting
// SQL text (~1.6MB+) is impractical to paste through the Supabase SQL
// editor's Monaco instance the way every prior migration/seed in this
// project has been run. Batched REST inserts via supabase-js do the same
// job without that size ceiling.
//
// Reads supabase/seed/permit_history_san_miguel.json -- the row/lookup
// data extracted from the project owner's reference dashboard, stripped
// of the live GoHighLevel API key and fetch code that came with it (see
// CLAUDE.md's write-up of this session for why). Row format:
//   [0]year [1]permitNo [2]businessName [3]ownerName [4]barangayIdx
//   [5]typeIdx [6]categoryIdx [7]description [8]ownerTypeIdx [9]genderIdx
//   [10]amountPaid [11]capital [12]grossSales [13]payFreqIdx [14]legacyLicenseNo
// -1 in an index field means "not recorded" in the source, mapped to null
// here rather than guessed.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const lines = readFileSync(join(__dirname, "..", "..", ".env.local"), "utf8").split(/\r?\n/);
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const BATCH_SIZE = 1000;

function mapRow(row, meta, businessIdByLicense, lguId) {
  const [year, permitNo, businessName, ownerName, brgyIdx, typeIdx, catIdx, description, otIdx, genderIdx, amountPaid, capital, grossSales, pfIdx, licenseRaw] = row;
  const legacyLicenseNo = licenseRaw ? String(licenseRaw) : null;

  return {
    lgu_id: lguId,
    business_id: legacyLicenseNo ? businessIdByLicense.get(legacyLicenseNo) ?? null : null,
    year,
    permit_no: permitNo || null,
    business_name: businessName || "(unnamed)",
    owner_name: ownerName || null,
    barangay: brgyIdx >= 0 ? meta.B[brgyIdx] : null,
    application_type: typeIdx === 0 ? "new" : typeIdx === 1 ? "renewal" : null,
    category: catIdx >= 0 ? meta.C[catIdx] : null,
    description: description || null,
    owner_type: otIdx >= 0 ? meta.OT[otIdx] : null,
    gender: genderIdx === 0 ? "Male" : genderIdx === 1 ? "Female" : null,
    amount_paid: amountPaid ?? null,
    capital: capital ?? null,
    gross_sales: grossSales ?? null,
    pay_frequency: pfIdx >= 0 ? meta.PF[pfIdx] : null,
    legacy_license_no: legacyLicenseNo,
  };
}

async function main() {
  const { meta, rows } = JSON.parse(readFileSync(join(__dirname, "permit_history_san_miguel.json"), "utf8"));
  console.log(`Loaded ${rows.length} rows from seed file.`);

  const { data: lgu, error: lguError } = await supabase.from("lgus").select("id").eq("name", "San Miguel").single();
  if (lguError || !lgu) throw lguError ?? new Error("San Miguel LGU not found");
  const lguId = lgu.id;

  const { data: businesses, error: bizError } = await supabase
    .from("businesses")
    .select("id, legacy_license_no")
    .eq("lgu_id", lguId)
    .not("legacy_license_no", "is", null);
  if (bizError) throw bizError;
  const businessIdByLicense = new Map(businesses.map((b) => [b.legacy_license_no, b.id]));
  console.log(`Loaded ${businessIdByLicense.size} existing businesses to link by legacy_license_no.`);

  const mapped = rows.map((r) => mapRow(r, meta, businessIdByLicense, lguId));
  const linked = mapped.filter((m) => m.business_id).length;
  console.log(`${linked} of ${mapped.length} rows matched an existing business by license number.`);

  let inserted = 0;
  for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
    const batch = mapped.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("permit_history").insert(batch);
    if (error) {
      console.error(`Batch starting at row ${i} failed:`, error.message);
      throw error;
    }
    inserted += batch.length;
    console.log(`Inserted ${inserted}/${mapped.length}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
