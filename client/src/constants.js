export const PROPERTY_TYPES = {
  flat: 'Flat / Apartment',
  shop: 'Shop',
  office: 'Office',
  residential: 'Residential plot / open land',
  commercial: 'Commercial',
  industrial: 'Industrial plot / land',
  agri_irrigated: 'Agricultural - irrigated',
  agri_non_irrigated: 'Agricultural - non irrigated',
};

// the rate columns each kind of PDF actually has
export const TYPES_BY_AREA = {
  CORPORATION: ['flat', 'shop', 'office', 'residential', 'industrial', 'agri_irrigated', 'agri_non_irrigated'],
  NAGARPALIKA: ['flat', 'shop', 'office', 'residential', 'industrial', 'agri_irrigated', 'agri_non_irrigated'],
  RURAL_NA: ['residential', 'commercial', 'industrial', 'agri_irrigated', 'agri_non_irrigated'],
};

export const PDF_TYPES = {
  CORPORATION: 'Corporation (city)',
  NAGARPALIKA: 'Nagarpalika (town)',
  RURAL_NA: 'Rural NA (village)',
};

export const AREA_UNITS = {
  sqmt: 'Sq. Mtr.',
  sqft: 'Sq. Ft.',
  sqyd: 'Sq. Yd.',
  guntha: 'Guntha',
  acre: 'Acre',
  hectare: 'Hectare',
};

export const STATUS = {
  verified: { label: 'Verified rate', tone: 'ok' },
  not_found: { label: 'Exact Match Not Found', tone: 'bad' },
  ambiguous: { label: 'Ambiguous - manual verification required', tone: 'warn' },
  rate_not_available: { label: 'Rate not available', tone: 'warn' },
  unsupported: { label: 'Not supported', tone: 'bad' },
  error: { label: 'Could not be verified', tone: 'bad' },
};

export const FIELDS = [
  ['district', 'District'],
  ['taluka', 'Taluka'],
  ['village', 'Village / Moje'],
  ['tps', 'TPS No.'],
  ['fp', 'FP No.'],
  ['rsNo', 'Survey / RS No.'],
  ['blNo', 'Block No.'],
];
