# official-application-form/

The actual live intake form San Miguel's BPLO uses today, extracted directly from its config on 2026-08-13 — not screenshots or a manual read-through. This is a GoHighLevel form widget (`https://links.muniserve.ph/widget/form/LLkWXPS7wlzQ5bjDUSxZ`); the page ships its full field list and conditional-logic rules server-rendered in a Nuxt SSR payload (`__NUXT_DATA__`), which was fetched and decoded (the payload uses an index-referenced array format, not plain JSON-with-repeated-values) rather than read visually — so this is the complete, exact configuration, including fields that only appear conditionally and would be easy to miss by clicking through the form once.

## Files

- **`fields.json`** — all 68 field definitions in display order, exactly as configured (labels, `type`, `required`, `picklistOptions`, `parentId` grouping, etc.). Includes section headers, the T&C/perjury declaration, captcha, and the submit button alongside real inputs — filter on `type` if you only want data-entry fields.
- **`conditional_logic.json`** — all 37 show/hide rules, each keyed by `selectedField` (matches a field's `hiddenFieldQueryKey`/`tag`) and `selectedOperation` (`isEqualTo` / `isNotEqualTo` / `isEmpty`), with an `outcome.value` naming the field(s) shown or hidden. This is the "hidden fields that only pop up when other fields are answered" the project owner flagged — e.g. `nature_of_business = "Billiard Hall"` → show `number_of_billiard_tables`; `business_premises_ownership = "Owned"` → show the tax declaration field but hide the lessor/rent cluster.

## Why this matters

`src/app/apply/page.tsx` (built in step 5, before this reference existed) is a much smaller approximation of this form — free-text `natureOfBusiness` instead of the ~200-option picklist the conditional rules actually key off, only 3 of the 9 nature-of-business-conditional field groups, and it's missing entire sections this form has: email, TIN, registration authority/no., tax type, organization type (Sole Prop/Partnership/Corporation/Cooperative — the same classification the CEDULA formula and cooperative-exemption questions in CLAUDE.md §7a/§7b depend on), the full structured address, owner's gender, business-activity/delivery-vehicle/employee-count fields, the entire premises-ownership → lessor/rent/tax-declaration cluster, tax-incentive cluster, signature capture, and the perjury/data-privacy declaration text.

Treat this as the source of truth for what the applicant form and its backing schema/API need to capture — the same status as the revenue-code scans in `../revenue-code-scans/`, not a nice-to-have.

## Known gaps in this extraction

- This is the form's **configuration**, not a live capture of BPLO's actual current fee-relevant business logic elsewhere in the LGU's process — cross-check field requiredness/labels with BPLO before treating every `required: true` as immovable (e.g. `Barangay` is oddly `required: false` here despite the rest of the address being required).
- `picklistOptions` for `Nature of Business` (~200 entries) is the authoritative list to validate/autocomplete against going forward — do not keep it as free text.
- The form's own field-grouping headers (Business Information & Registration → Main Office Address → Owner/Representative Info → Business Operation → Documents to Submit) are a reasonable section order to mirror in the rebuild.
