// MUNISERVE - Fee Computation Code Action v1.2
// Municipality: San Miguel, Bulacan
// Source: Local Revenue Code, Sections 4 & 5
//
// INPUTS:
//   inputData.application_type         - "new" | "renewal"
//   inputData.nature_of_business       - string
//   inputData.lbt_category             - string (from PSIC Autofill)
//   inputData.gross_sales              - number
//   inputData.capital_investment       - number
//   inputData.preceding_year_lbt_paid  - number
//   inputData.billiard_table_count     - number
//   inputData.lodger_count             - number
//   inputData.land_area_hectares       - number
//   inputData.locality_count           - number
//   inputData.floor_area_sqm           - number
//   inputData.seating_capacity         - number
//   inputData.is_aircon                - "yes" | "no"
//   inputData.is_branch_office         - "yes" | "no"
//   inputData.business_tax_payment     - "Annual" | "Bi-Annually" | "Quarterly"
//
// NOTE: is_essential_commodity is AUTO-DETECTED from nature_of_business.
//
// OUTPUTS:
//   output.lbt_amount                  - full annual LBT (store as preceding_year_lbt_paid)
//   output.business_tax                - frequency-adjusted LBT due now
//   output.lbt_installment_amount      - per-installment amount for reminder automation
//   output.lbt_category_label          - human-readable schedule name
//   output.lbt_basis_amount            - gross_sales or capital_investment used
//   output.lbt_basis_type              - "Gross Sales (Preceding Year)" | "Capital Investment"
//   output.mayors_permit_fee           - computed Mayor's Permit fee
//   output.mayors_permit_basis         - how fee was determined
//   output.application_fee             - PHP 10 fixed
//   output.subtotal                    - business_tax + mayors_permit_fee + application_fee
//   output.essential_commodity         - "Yes" | "No"
//   output.computation_notes           - flags for BPLO review

// --- HELPERS ---

function toNum(val) {
  if (val === null || val === undefined || val === '') return 0;
  var n = parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function roundPeso(val) {
  return Math.round(val * 100) / 100;
}

function normalize(str) {
  return String(str || '').toLowerCase().trim();
}

// --- READ INPUTS ---

var appType     = normalize(inputData.application_type);
var isNew       = appType === 'new';
var natBus      = normalize(inputData.nature_of_business);
var lbtCat      = normalize(inputData.lbt_category);
var grossSales  = toNum(inputData.gross_sales);
var capInvest   = toNum(inputData.capital_investment);
var priorLBT    = toNum(inputData.preceding_year_lbt_paid);
var tableCount  = Math.max(1, toNum(inputData.billiard_table_count) || 1);
var lodgerCount = toNum(inputData.lodger_count);
var hectares    = toNum(inputData.land_area_hectares);
var localities  = toNum(inputData.locality_count);
var floorArea   = toNum(inputData.floor_area_sqm);
var seats       = toNum(inputData.seating_capacity);
var isAircon    = normalize(inputData.is_aircon) === 'yes';
var isBranch    = normalize(inputData.is_branch_office) === 'yes';
var paymentFreq = normalize(inputData.business_tax_payment);

// --- AUTO-DETECT ESSENTIAL COMMODITY ---
// RA 7160 Sec. 143(c): 50% LBT discount for essential commodities.

var ESSENTIAL_COMMODITY_TYPES = [
  'rice dealer', 'rice retailer', 'rice mill', 'rice and corn dealer',
  'meat shop', 'fish dealer', 'fish/seafood dealer', 'fish/seafood stall',
  'seafood dealer', 'vegetable stall', 'fruit stall', 'vegetable/fruit stall',
  'fruit and vegetable stand', 'pharmacy', 'drugstore', 'drug store',
  'school supplies store', 'sari-sari store', 'grocery store', 'grocery',
  'general merchandise', 'feed store', 'agricultural supply store',
  'agri-vet supply', 'poultry and livestock supply', 'cooking oil retailer',
  'salt dealer', 'bread retailer', 'bakery'
];

var isEssential = ESSENTIAL_COMMODITY_TYPES.some(function(t) {
  return natBus.includes(t);
});

// Basis for LBT
var lbtBasis     = isNew ? capInvest : grossSales;
var lbtBasisType = isNew ? 'Capital Investment' : 'Gross Sales (Preceding Year)';

// --- LBT SCHEDULE FUNCTIONS ---
// Source: Section 5 of San Miguel Local Revenue Code

function lbtManufacturer(sales) {
  if (sales <      10000) return     165;
  if (sales <      15000) return     220;
  if (sales <      20000) return     302;
  if (sales <      30000) return     440;
  if (sales <      40000) return     660;
  if (sales <      50000) return     825;
  if (sales <      75000) return    1320;
  if (sales <     100000) return    1650;
  if (sales <     150000) return    2200;
  if (sales <     200000) return    2750;
  if (sales <     300000) return    3850;
  if (sales <     500000) return    5500;
  if (sales <     750000) return    8000;
  if (sales <    1000000) return   10000;
  if (sales <    2000000) return   13750;
  if (sales <    3000000) return   16500;
  if (sales <    4000000) return   19800;
  if (sales <    5000000) return   23100;
  if (sales <    6500000) return   24375;
  return sales * 0.00375;
}

function lbtWholesaler(sales) {
  if (sales <       1000) return      18;
  if (sales <       2000) return      33;
  if (sales <       3000) return      50;
  if (sales <       4000) return      72;
  if (sales <       5000) return     100;
  if (sales <       6000) return     121;
  if (sales <       7000) return     143;
  if (sales <       8000) return     165;
  if (sales <      10000) return     187;
  if (sales <      15000) return     220;
  if (sales <      20000) return     275;
  if (sales <      30000) return     330;
  if (sales <      40000) return     440;
  if (sales <      50000) return     660;
  if (sales <      75000) return     990;
  if (sales <     100000) return    1320;
  if (sales <     150000) return    1870;
  if (sales <     200000) return    2420;
  if (sales <     300000) return    3300;
  if (sales <     500000) return    4400;
  if (sales <     750000) return    6600;
  if (sales <    1000000) return    8000;
  if (sales <    2000000) return   10000;
  return sales * 0.005;
}

function lbtRetailer(sales) {
  if (sales <= 0)       return 0;
  if (sales <= 400000)  return sales * 0.02;
  return (400000 * 0.02) + ((sales - 400000) * 0.01);
}

function lbtContractor(receipts) {
  if (receipts <       5000) return    27.50;
  if (receipts <      10000) return    61.60;
  if (receipts <      15000) return   104.50;
  if (receipts <      20000) return   165;
  if (receipts <      30000) return   275;
  if (receipts <      40000) return   385;
  if (receipts <      50000) return   550;
  if (receipts <      75000) return   880;
  if (receipts <     100000) return  1320;
  if (receipts <     150000) return  1980;
  if (receipts <     200000) return  2640;
  if (receipts <     250000) return  3630;
  if (receipts <     300000) return  4620;
  if (receipts <     400000) return  6160;
  if (receipts <     500000) return  8250;
  if (receipts <     750000) return  9250;
  if (receipts <    1000000) return 10250;
  if (receipts <    2000000) return 11000;
  return receipts * 0.005;
}

function lbtBank(receipts) {
  return receipts * 0.005;
}

function lbtFoodBeverage(receipts) {
  if (receipts <=      0) return 0;
  if (receipts <=  20000) return receipts * 0.0025;
  if (receipts <=  50000) return     50 + (receipts -  20000) * 0.0050;
  if (receipts <= 100000) return    200 + (receipts -  50000) * 0.0075;
  if (receipts <= 200000) return    550 + (receipts - 100000) * 0.0100;
  if (receipts <= 500000) return   1550 + (receipts - 200000) * 0.0125;
  if (receipts <= 750000) return   5300 + (receipts - 500000) * 0.0150;
  if (receipts <=1000000) return   9050 + (receipts - 750000) * 0.0175;
  return 13425 + (receipts - 1000000) * 0.02;
}

function lbtAmusement(receipts) {
  if (receipts <=      0) return 0;
  if (receipts <=  20000) return receipts * 0.0125;
  if (receipts <=  50000) return     50 + (receipts -  20000) * 0.0050;
  if (receipts <= 100000) return    200 + (receipts -  50000) * 0.0075;
  if (receipts <= 200000) return    550 + (receipts - 100000) * 0.0100;
  if (receipts <= 500000) return   1550 + (receipts - 200000) * 0.0125;
  if (receipts <= 750000) return   5300 + (receipts - 500000) * 0.0150;
  if (receipts <=1000000) return   9050 + (receipts - 750000) * 0.0175;
  return 23425 + (receipts - 1000000) * 0.02;
}

function lbtOther(receipts) {
  if (receipts <=      0) return 5;
  if (receipts <=  20000) return Math.max(5, receipts * 0.0025);
  if (receipts <=  50000) return     50 + (receipts -  20000) * 0.0050;
  if (receipts <= 100000) return    200 + (receipts -  50000) * 0.0075;
  if (receipts <= 200000) return    550 + (receipts - 100000) * 0.0100;
  if (receipts <= 500000) return   1550 + (receipts - 200000) * 0.0125;
  if (receipts <= 750000) return   5300 + (receipts - 500000) * 0.0150;
  if (receipts <=1000000) return   9050 + (receipts - 750000) * 0.0175;
  return 13425 + (receipts - 1000000) * 0.02;
}

function lbtLessor(receipts) {
  return receipts * 0.015;
}

// --- COMPUTE LBT ---

var lbtAmount = 0;
var lbtLabel  = '';

if (lbtCat === 'manufacturer') {
  lbtAmount = lbtManufacturer(lbtBasis);
  lbtLabel  = 'Manufacturer / Assembler / Processor (Schedule A)';
} else if (lbtCat === 'wholesaler') {
  lbtAmount = lbtWholesaler(lbtBasis);
  lbtLabel  = 'Wholesaler / Importer / Distributor (Schedule B)';
} else if (lbtCat === 'retailer') {
  lbtAmount = lbtRetailer(lbtBasis);
  lbtLabel  = 'Retailer (Schedule D)';
} else if (lbtCat === 'contractor') {
  lbtAmount = lbtContractor(lbtBasis);
  lbtLabel  = 'Contractor / Independent Contractor (Schedule E)';
} else if (lbtCat === 'bank_financial') {
  lbtAmount = lbtBank(lbtBasis);
  lbtLabel  = 'Bank / Financial Institution (Schedule F)';
} else if (lbtCat === 'food_beverage') {
  lbtAmount = lbtFoodBeverage(lbtBasis);
  lbtLabel  = 'Food & Beverage Establishment (Schedule G)';
} else if (lbtCat === 'amusement') {
  lbtAmount = lbtAmusement(lbtBasis);
  lbtLabel  = 'Amusement / Recreational Place (Schedule H)';
} else if (lbtCat === 'lessor') {
  lbtAmount = lbtLessor(lbtBasis);
  lbtLabel  = 'Lessor / Sublessor of Real Estate (Schedule J)';
} else {
  lbtAmount = lbtOther(lbtBasis);
  lbtLabel  = 'Other Business (Schedule I)';
}

// Essential commodity 50% discount
var essentialEligible = ['manufacturer', 'wholesaler', 'retailer'].indexOf(lbtCat) !== -1;
if (isEssential && essentialEligible) {
  lbtAmount = lbtAmount * 0.5;
}

// --- MAYOR'S PERMIT FEE ---
// Source: Section 4.01 of San Miguel Local Revenue Code

function computeCinemaFee(seatCount, aircon) {
  if (aircon) {
    if (seatCount <  500) return 200;
    if (seatCount < 1000) return 400;
    return 500;
  } else {
    if (seatCount === 0)  return 50;
    if (seatCount <  500) return 100;
    if (seatCount < 1000) return 300;
    return 400;
  }
}

function getSpecialPermitFee() {
  if (natBus === 'night and day club')
    return { fee: 1000, basis: 'Night and Day Club (2.01)' };
  if (natBus === 'night club' || natBus === 'entertainment club')
    return { fee: 800, basis: 'Night Club (2.01)' };
  if (natBus === 'cabaret' || natBus === 'dance hall')
    return { fee: 200, basis: 'Cabaret / Dance Hall (2.01)' };
  if (natBus === 'ktv/videoke bar')
    return { fee: 800, basis: 'KTV / Videoke Bar (2.01)' };
  if (natBus === 'bar/pub' || natBus === 'restobar')
    return { fee: 300, basis: 'Bar / Restobar (2.01)' };
  if (natBus === 'swimming pool')
    return { fee: 500, basis: 'Swimming Pool (2.01)' };

  if (natBus === 'billiard hall') {
    var bFee = 100 + (Math.max(0, tableCount - 1) * 50);
    return { fee: bFee, basis: 'Billiard Hall: PHP 100 first table + PHP 50 x ' + (tableCount - 1) + ' additional table(s) (2.01)' };
  }

  if (natBus === 'cinema/movie theater') {
    var cFee = computeCinemaFee(seats, isAircon);
    var acLabel = isAircon ? 'Air-Conditioned' : 'Non-Air-Conditioned';
    return { fee: cFee, basis: 'Cinema (' + acLabel + ', ' + seats + ' seats) (2.01)' };
  }

  if (natBus === 'lottery/betting station')
    return { fee: 200, basis: 'Off-track Betting Station (2.01)' };
  if (natBus === 'amusement center/arcade')
    return { fee: 50, basis: 'Amusement Device per device - BPLO to verify device count (2.01)' };
  if (natBus === 'cockpit/sabungan')
    return { fee: 200, basis: 'Cockpit / Sabungan (2.01)' };
  if (natBus === 'bowling alley')
    return { fee: 500, basis: 'Bowling Alley - Automatic (2.01)' };
  if (natBus === 'sports complex/court rental')
    return { fee: 300, basis: 'Sports Court per court - BPLO to verify court count (2.01)' };

  if (natBus === 'commercial bank')
    return { fee: isBranch ? 2000 : 3000, basis: 'Commercial Bank (' + (isBranch ? 'Branch' : 'Principal') + ' Office) (2.02)' };
  if (natBus === 'savings bank')
    return { fee: isBranch ? 1000 : 2000, basis: 'Savings Bank (' + (isBranch ? 'Branch' : 'Principal') + ' Office) (2.02)' };
  if (natBus === 'rural bank' || natBus === 'bank branch')
    return { fee: 1000, basis: 'Rural Bank (2.02)' };
  if (natBus === 'pawnshop')
    return { fee: 500, basis: 'Pawnshop (2.02)' };
  if (natBus === 'money changer/remittance')
    return { fee: 500, basis: 'Money Changer / Remittance (2.02)' };
  if (natBus === 'lending investor')
    return { fee: 500, basis: 'Lending Investor (2.02)' };
  if (natBus === 'credit cooperative')
    return { fee: 500, basis: 'Credit Cooperative (2.02)' };
  if (natBus === 'finance company' || natBus === 'finance & investment company' || natBus === 'investment company')
    return { fee: isBranch ? 500 : 1000, basis: 'Finance & Investment Company (' + (isBranch ? 'Branch' : 'Principal') + ' Office) (2.02)' };
  if (natBus === 'insurance agency')
    return { fee: 200, basis: 'Insurance Agency (2.13)' };

  if (natBus === 'boarding house')
    return { fee: 100, basis: 'Boarding House (2.03)' };

  if (['lodging house','inn/lodge','dormitory/bedspace','transient house','pension house'].indexOf(natBus) !== -1) {
    var lFee, lNote;
    if (lodgerCount < 15)       { lFee = 100; lNote = 'less than 15 lodgers'; }
    else if (lodgerCount <= 34) { lFee = 200; lNote = '15 to 34 lodgers'; }
    else                        { lFee = 300; lNote = '35 or more lodgers'; }
    return { fee: lFee, basis: 'Lodging House (' + lodgerCount + ' lodgers - ' + lNote + ') (2.04)' };
  }

  if (natBus === 'real estate brokerage') {
    var rFee;
    if (hectares < 5)       rFee = 200;
    else if (hectares <= 9) rFee = 400;
    else                    rFee = 600;
    return { fee: rFee, basis: 'Real Estate Dealer (' + hectares + ' hectares) (2.05)' };
  }

  if (natBus === 'property developer/subdivision') {
    var sFee;
    if (hectares < 5)       sFee = 500;
    else if (hectares <= 9) sFee = 1000;
    else                    sFee = 1500;
    return { fee: sFee, basis: 'Subdivision Developer (' + hectares + ' hectares) (2.17)' };
  }

  if (['private cemetery','memorial park','private memorial park','cemetery'].indexOf(natBus) !== -1) {
    var mFee = hectares < 2 ? 1000 : 3000;
    return { fee: mFee, basis: 'Memorial Park (' + hectares + ' hectares) (2.07)' };
  }

  if (natBus === 'cold storage' || natBus === 'cold storage facility' || natBus === 'refrigerated storage')
    return { fee: 200, basis: 'Cold Storage (2.08)' };

  if (['lumberyard','lumber dealer','lumber yard'].indexOf(natBus) !== -1)
    return { fee: 500, basis: 'Lumberyard (2.09)' };

  if (['used car lot','car exchange','second-hand car dealer','used vehicle dealer'].indexOf(natBus) !== -1)
    return { fee: 300, basis: 'Car Exchange on Consignment (2.10)' };

  if (natBus === 'veterinary clinic')
    return { fee: 200, basis: 'Veterinary Clinic (2.14)' };

  if (natBus === 'travel agency')
    return { fee: 200, basis: 'Travel Agency (2.15)' };

  if (['dance school/studio','fitness center/gym','sports academy','sports complex/court rental'].indexOf(natBus) !== -1)
    return { fee: 200, basis: 'Dance School / Fitness / Sports Academy (2.18)' };

  if (natBus === 'security agency') {
    var secFee = 300 + (localities * 50);
    return { fee: secFee, basis: 'Security Agency: PHP 300 principal + PHP 50 x ' + localities + ' locality(ies) (2.19)' };
  }

  if (['vocational school','technical school','tesda-accredited school','technical-vocational school'].indexOf(natBus) !== -1)
    return { fee: 200, basis: 'Vocational / Technical School (2.20)' };

  if (['piggery/hog raising','poultry farm','chicken farm'].indexOf(natBus) !== -1)
    return { fee: 500, basis: 'Poultry / Piggery (2.24)' };

  if (natBus === 'wholesale liquor dealer' || natBus === 'liquor wholesale')
    return { fee: 300, basis: 'Wholesale Liquor (2.23)' };

  if (natBus === 'warehouse/storage facility') {
    var wFee;
    if (floorArea <  50)  wFee = 150;
    else if (floorArea < 100) wFee = 200;
    else if (floorArea < 200) wFee = 300;
    else if (floorArea < 300) wFee = 400;
    else if (floorArea < 400) wFee = 500;
    else                      wFee = 600;
    return { fee: wFee, basis: 'Private Warehouse / Bodega (' + floorArea + ' sq.m.) (2.26)' };
  }

  if (natBus === 'events place/function hall')
    return { fee: 200, basis: 'Events Place / Function Hall (2.21)' };

  return null;
}

// Determine Mayor's Permit Fee
var mayorsPermitFee   = 0;
var mayorsPermitBasis = '';
var specialResult     = getSpecialPermitFee();

if (specialResult) {
  mayorsPermitFee   = specialResult.fee;
  mayorsPermitBasis = specialResult.basis;
} else {
  if (isNew) {
    mayorsPermitFee   = 500;
    mayorsPermitBasis = 'New business - flat rate (Section 4.01)';
  } else {
    if (priorLBT < 300) {
      mayorsPermitFee   = 150;
      mayorsPermitBasis = 'Renewal: prior LBT PHP ' + priorLBT + ' (below PHP 300) (Section 4.01)';
    } else if (priorLBT <= 500) {
      mayorsPermitFee   = 250;
      mayorsPermitBasis = 'Renewal: prior LBT PHP ' + priorLBT + ' (PHP 300 to PHP 500) (Section 4.01)';
    } else {
      mayorsPermitFee   = 350;
      mayorsPermitBasis = 'Renewal: prior LBT PHP ' + priorLBT + ' (above PHP 500) (Section 4.01)';
    }
  }
}

// --- PAYMENT FREQUENCY ADJUSTMENT (LBT only) ---
// Mayor's Permit is always full annual. Only LBT is split by frequency.

var frequencyDivisor = 1;
var frequencyLabel   = 'Annual';

if (paymentFreq === 'bi-annually') {
  frequencyDivisor = 2;
  frequencyLabel   = 'Bi-Annual';
} else if (paymentFreq === 'quarterly') {
  frequencyDivisor = 4;
  frequencyLabel   = 'Quarterly';
}

var businessTax          = roundPeso(lbtAmount / frequencyDivisor);
var lbtInstallmentAmount = frequencyDivisor > 1 ? businessTax : 0;

// --- APPLICATION FEE ---
// Section 4.03 - PHP 10 per application
var applicationFee = 10;

// --- COMPUTATION NOTES ---
var notes = [];

if (isNew) {
  notes.push('NEW application: LBT based on capital investment.');
} else {
  notes.push('RENEWAL: LBT based on preceding year gross sales/receipts.');
}

if (isEssential && essentialEligible) {
  notes.push('Essential commodity discount applied: LBT reduced by 50%.');
}

if (isEssential && !essentialEligible) {
  notes.push('NOTE: Essential commodity flag set but LBT category is not manufacturer/wholesaler/retailer - discount not applied.');
}

if (lbtBasis === 0) {
  notes.push('WARNING: Gross sales / capital investment is PHP 0. Please verify with applicant.');
}

if (frequencyDivisor > 1) {
  notes.push('Payment frequency: ' + frequencyLabel + '. LBT due now: PHP ' + businessTax + ' (full annual: PHP ' + roundPeso(lbtAmount) + '). Installment for reminders: PHP ' + lbtInstallmentAmount + '.');
}

if (specialResult && (natBus === 'amusement center/arcade' || natBus === 'sports complex/court rental')) {
  notes.push("BPLO ACTION REQUIRED: Mayor's Permit fee depends on device/court count - verify and adjust manually.");
}

// --- OUTPUT ---
var subtotal = roundPeso(businessTax + mayorsPermitFee + applicationFee);

output = {
  lbt_amount:             roundPeso(lbtAmount),
  business_tax:           businessTax,
  lbt_installment_amount: lbtInstallmentAmount,
  lbt_category_label:     lbtLabel,
  lbt_basis_amount:       lbtBasis,
  lbt_basis_type:         lbtBasisType,
  mayors_permit_fee:      mayorsPermitFee,
  mayors_permit_basis:    mayorsPermitBasis,
  application_fee:        applicationFee,
  subtotal:               subtotal,
  essential_commodity:    isEssential ? 'Yes' : 'No',
  computation_notes:      notes.join(' | ')
};
