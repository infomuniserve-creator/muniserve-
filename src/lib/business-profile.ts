/**
 * Shared shape for "a business's stored profile," used by every applicant
 * route that needs to pre-fill the application form from an existing
 * businesses row (renewal via legacy-claim lookup, or a returning owner's
 * second-and-later renewal). One column list + one mapper instead of
 * duplicating the same ~35 fields in lookup-license and my-businesses.
 */

export const BUSINESS_PROFILE_COLUMNS =
  "id, business_name, legacy_owner_name, barangay, nature_of_business, lbt_category, gross_sales_history, " +
  "business_tax_payment, organization_type, registration_authority, registration_no, tin, tax_type, trade_name, " +
  "unit_street, city_town, province, zip_code, " +
  "business_activity, delivery_vehicle_count, operation_address_different, operation_address, " +
  "business_area_sqm, total_floor_area_sqm, secondary_business_activity, " +
  "premises_ownership, tax_declaration_no, monthly_rent, lessor_name, lessor_contact_no, lessor_address, " +
  "has_employees, male_employee_count, female_employee_count, employees_residing_in_lgu_count, " +
  "has_barangay_clearance, has_tax_incentives, " +
  "billiard_table_count, lodger_count, land_area_hectares, guard_post_count, warehouse_floor_area_sqm, " +
  "seating_capacity, is_aircon, is_branch_office, animal_count";

// Matches the select() above -- kept loose (unknown-shaped nested rows are
// still fine to index into) since this is only ever fed the result of a
// query built with BUSINESS_PROFILE_COLUMNS.
type BusinessProfileRow = Record<string, unknown>;

export type BusinessProfile = ReturnType<typeof mapBusinessProfile>;

export function mapBusinessProfile(b: BusinessProfileRow) {
  const history = (b.gross_sales_history as Record<string, number> | null) ?? {};
  const latestYear = Object.keys(history).sort().at(-1);

  return {
    id: b.id as string,
    businessName: b.business_name as string,
    barangay: (b.barangay as string | null) ?? null,
    natureOfBusiness: (b.nature_of_business as string | null) ?? null,
    lbtCategory: (b.lbt_category as string | null) ?? null,
    grossSales: latestYear ? history[latestYear] : null,
    businessTaxPayment: (b.business_tax_payment as string | null) ?? null,
    organizationType: (b.organization_type as string | null) ?? null,
    registrationAuthority: (b.registration_authority as string | null) ?? null,
    registrationNo: (b.registration_no as string | null) ?? null,
    tin: (b.tin as string | null) ?? null,
    taxType: (b.tax_type as string | null) ?? null,
    tradeName: (b.trade_name as string | null) ?? null,
    unitStreet: (b.unit_street as string | null) ?? null,
    cityTown: (b.city_town as string | null) ?? null,
    province: (b.province as string | null) ?? null,
    zipCode: (b.zip_code as string | null) ?? null,
    businessActivity: (b.business_activity as string[] | null) ?? [],
    deliveryVehicleCount: (b.delivery_vehicle_count as string | null) ?? null,
    operationAddressSame: b.operation_address_different === true
      ? "Business Operation is in Different Address"
      : b.operation_address_different === false
        ? "The Same as Main Office Address"
        : null,
    operationAddress: (b.operation_address as string | null) ?? null,
    businessAreaSqm: (b.business_area_sqm as string | null) ?? null,
    totalFloorAreaSqm: (b.total_floor_area_sqm as string | null) ?? null,
    secondaryBusinessActivity: (b.secondary_business_activity as string | null) ?? null,
    premisesOwnership: (b.premises_ownership as string | null) ?? null,
    taxDeclarationNo: (b.tax_declaration_no as string | null) ?? null,
    monthlyRent: (b.monthly_rent as string | null) ?? null,
    lessorName: (b.lessor_name as string | null) ?? null,
    lessorContactNo: (b.lessor_contact_no as string | null) ?? null,
    lessorAddress: (b.lessor_address as string | null) ?? null,
    hasEmployees: booleanToYesNo(b.has_employees),
    maleEmployeeCount: (b.male_employee_count as number | null) ?? null,
    femaleEmployeeCount: (b.female_employee_count as number | null) ?? null,
    employeesResidingInLguCount: (b.employees_residing_in_lgu_count as number | null) ?? null,
    hasBarangayClearance: (b.has_barangay_clearance as string | null) ?? null,
    hasTaxIncentives: booleanToYesNo(b.has_tax_incentives),
    billiardTableCount: (b.billiard_table_count as number | null) ?? null,
    lodgerCount: (b.lodger_count as number | null) ?? null,
    landAreaHectares: (b.land_area_hectares as number | null) ?? null,
    guardPostCount: (b.guard_post_count as number | null) ?? null,
    warehouseFloorAreaSqm: (b.warehouse_floor_area_sqm as number | null) ?? null,
    seatingCapacity: (b.seating_capacity as number | null) ?? null,
    isAircon: booleanToYesNo(b.is_aircon),
    isBranchOffice: booleanToYesNo(b.is_branch_office),
    animalCount: (b.animal_count as number | null) ?? null,
  };
}

function booleanToYesNo(value: unknown): "Yes" | "No" | null {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return null;
}
