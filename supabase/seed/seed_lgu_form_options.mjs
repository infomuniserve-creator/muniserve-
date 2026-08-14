// One-time seed for lgu_form_options (migration 0021).
//
// Run with: node --experimental-strip-types --no-warnings supabase/seed/seed_lgu_form_options.mjs
//
// Backfills San Miguel's existing barangay list and nature-of-business
// options (previously hardcoded in src/lib/san-miguel-form-options.ts,
// see that file's own header) into the new per-LGU table, in their
// original order (sort_order). Node + service-role, same pattern as
// import_permit_history.mjs -- not because this data is large (it isn't,
// ~250 rows total), but for consistency and because it's simpler than
// hand-typing ~250 literal business names/barangays through the SQL
// editor's Monaco instance without a transcription error.
//
// src/lib/san-miguel-form-options.ts itself is untouched by this --
// NATURE_OF_BUSINESS_OPTIONS still exists there and is still imported at
// runtime, as the generic default used for any LGU that hasn't set its
// own nature-of-business list yet (src/lib/lgu-form-options.ts). Only
// BARANGAY_OPTIONS is fully superseded by this table (a barangay list has
// no sensible cross-LGU default -- see CLAUDE.md 7o's write-up of this).

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

// Copied verbatim from src/lib/san-miguel-form-options.ts as of this seed
// -- see that file for provenance (reference/official-application-form/fields.json).
const BARANGAYS = [
  "Bagong Pag-asa", "Bagong Silang", "Balaong", "Balite", "Bantog", "Bardias", "Baritan",
  "Batasan Bata", "Batasan Matanda", "Biak na Bato", "Biclat", "Buga", "Buliran", "Bulualto",
  "Calumpang", "Cambio", "Camias", "Ilog Bulo", "King Kabayo", "Labne", "Lambakin", "Magmarale",
  "Malibay", "Maligaya", "Mandile", "Masalipit", "Pacalag", "Paliwasan", "Partida", "Pinambaran",
  "Poblacion", "Pulong Bayabas", "Pulong Duhat", "Sacdalan", "Salacot", "Salangan", "San Agustin",
  "San Jose", "San Juan", "San Vicente", "Sapang", "Sibul", "Sta. Ines", "Sta. Lucia",
  "Sta. Rita Bata", "Sta. Rita Matanda", "Tartaro", "Tibagan", "Tigpalas",
];

const NATURE_OF_BUSINESS = [
  "Piggery/Hog Raising", "Poultry Farm", "Chicken Farm", "Fish Pond/Aquaculture", "Vegetable Farming",
  "Rice/Corn Farming", "Flower Farm", "Plant Nursery/Garden Center", "Rice Mill", "Ice Plant",
  "Purified/Mineral Water Plant", "Bottled Water Production", "T-shirt Printing/Sublimation", "Welding Shop",
  "Steel Fabrication", "Bakery (Manufacturing)", "Garment Manufacturing", "Furniture Manufacturing",
  "Hollow Blocks/Concrete Products", "Food Processing", "Soap/Detergent Manufacturing", "Handicraft Manufacturing",
  "Print Shop", "Junk Shop/Scrap Dealer", "Recycling Shop", "General Contractor", "Civil/Road Works Contractor",
  "Electrical Services", "Plumbing Services", "Air Conditioning Installation", "Painting Services",
  "Tile/Masonry Works", "Pest Control Services", "Sari-sari Store", "Mini-mart", "Grocery Store",
  "Convenience Store", "Supermarket", "Department Store", "General Merchandise", "Cooperative Store",
  "Meat Shop", "Fish/Seafood Stall", "Vegetable/Fruit Stall", "Rice Retailer", "Liquor Store",
  "Water Refilling Station", "Feed/Agri Supply Store", "Cellphone Store", "Computer/Gadget Store",
  "Electrical Supplies Store", "Hardware Store", "Construction Materials Store", "Plumbing Supply Store",
  "Appliance Store", "Furniture Store", "Sporting Goods Store", "Toy Store", "Musical Instruments Store",
  "Boutique/Clothing Store", "Shoe Store/Footwear", "Fabric/Textile Store", "Uniform Shop", "Baby/Kids Store",
  "Pharmacy/Drugstore", "Jewelry Store", "Flower Shop", "Optical Shop", "Bookstore", "School Supplies Store",
  "Office Supplies Store", "Ukay-ukay/Thrift Shop", "Second-hand Goods Store", "Pet Shop",
  "Online Selling/E-commerce", "Handicraft/Gift Shop", "Gasoline/Fuel Station", "LPG/Gas Dealer",
  "Car Dealership", "Motorcycle Dealership", "Auto Parts Store", "Motorcycle Parts Store", "Tire Shop",
  "Auto Repair", "Motorcycle Repair", "Vulcanizing Shop", "Car Wash", "Aircon Repair/Auto",
  "Bakery (Retail Only)", "Trucking Service", "Cargo/Freight Service", "Courier/Delivery Service",
  "Taxi Operation", "Tricycle/Pedicab Operation", "Jeepney/AUV Operation", "Habal-habal/Moto Transport",
  "Car Rental", "Warehouse/Storage Facility", "Hotel", "Resort/Beach Resort", "Inn/Lodge", "Boarding House",
  "Pension House", "Dormitory/Bedspace", "Transient House", "Restaurant", "Fast Food",
  "Carinderia/Turo-turo", "Canteen", "Catering Services", "Pizzeria", "Food Car", "Ice Cream Shop",
  "Lechon/BBQ Stand", "Bakeshop (Bake+Sell)", "Cafe/Coffee Shop", "Milk Tea Shop", "Bar/Pub", "Restobar",
  "Internet/Broadband Provider", "Cable TV Provider", "IT/Software Services", "Pawnshop",
  "Money Changer/Remittance", "Lending Investor", "Credit Cooperative", "Memorial/Pre-need Plans",
  "Insurance Agency", "Apartment/Room Rental", "Property Developer/Subdivision", "Real Estate Brokerage",
  "Photo Studio", "Photography/Videography", "Photobooth", "Graphic Design Studio", "Advertising Agency",
  "Law Firm", "Notary Public", "Accounting Services", "Architecture/Engineering", "Consulting Services",
  "Veterinary Clinic", "Security Agency", "Manpower/Staffing Agency", "Recruitment Agency",
  "Janitorial/Cleaning Services", "Events Place/Function Hall", "Event Planner/Coordinator", "BPO/Call Center",
  "Travel Agency", "Photocopy/Printing Services", "Parking Lot Operation", "Tutorial/Review Center",
  "Driving School", "Daycare/Preschool", "Computer Training Center", "Language School", "Music School",
  "Dance School/Studio", "Sports Academy", "Elementary/Grade School", "High School/Secondary School",
  "Medical Clinic", "Dental Clinic", "Diagnostic Laboratory", "Physical Therapy/Rehab Center",
  "Dialysis Center", "Birth Center/Lying-in Clinic", "Home Care Services", "Fitness Center/Gym",
  "Internet Cafe / Computer Gaming", "Billiard Hall", "KTV/Videoke Bar", "Cinema/Movie Theater",
  "Amusement Center/Arcade", "Sports Complex/Court Rental", "Swimming Pool", "Bowling Alley",
  "Cockpit/Sabungan", "Lottery/Betting Station", "Barber Shop", "Beauty Parlor/Salon", "Nail Salon",
  "Spa/Wellness Center", "Massage Parlor", "Laundry Shop", "Dry Cleaning", "Funeral Parlor",
  "Tailoring/Dressmaking", "Embroidery/Alteration Shop", "Pet Grooming", "Tattoo Parlor", "Shoe Repair",
  "Watch Repair", "Cellphone Repair", "Computer Repair", "Appliance Repair", "Aircon Repair/Services",
  "Tarpaulin Printing", "E-loading/Prepaid Loading", "Other - BPLO to Determine", "Rural Bank",
  "Commercial Bank", "Savings Bank", "Bank Branch", "Finance Company", "Finance & Investment Company",
  "Lodging House", "Wholesale Liquor Dealer", "Lumberyard", "Cold Storage", "Used Car Lot", "Car Exchange",
  "Private Cemetery", "Memorial Park", "Vocational School", "Technical School", "Night Club", "Cabaret",
  "Dance Hall",
];

async function main() {
  const { data: lgu, error: lguError } = await supabase.from("lgus").select("id").eq("name", "San Miguel").single();
  if (lguError || !lgu) throw lguError ?? new Error("San Miguel not found");

  const rows = [
    ...BARANGAYS.map((value, i) => ({ lgu_id: lgu.id, option_type: "barangay", value, sort_order: i })),
    ...NATURE_OF_BUSINESS.map((value, i) => ({ lgu_id: lgu.id, option_type: "nature_of_business", value, sort_order: i })),
  ];

  const { error } = await supabase.from("lgu_form_options").insert(rows);
  if (error) throw error;

  console.log(`Inserted ${rows.length} rows (${BARANGAYS.length} barangays, ${NATURE_OF_BUSINESS.length} nature-of-business options) for San Miguel.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
