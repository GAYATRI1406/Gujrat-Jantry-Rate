export const PROPERTY_TYPES = {
  flat: 'Flat / Apartment',
  shop: 'Shop',
  office: 'Office',
  residential: 'Open land / Plot - Residential',
  industrial: 'Open land - Industrial',
  commercial: 'Commercial',
};

export const PDF_TYPES = {
  CORPORATION: 'Corporation (city)',
  NAGARPALIKA: 'Nagarpalika (town)',
  RURAL_NA: 'Rural NA (village)',
};

export const STATUS = {
  found: { label: 'Rate found', tone: 'ok' },
  fallback: { label: 'Fallback value used', tone: 'warn' },
  no_data: { label: 'No data found', tone: 'bad' },
  insufficient: { label: 'Insufficient data found', tone: 'bad' },
};

export const SAMPLES = [
  {
    label: 'Kosad flat (Corporation)',
    text: 'Moje Kosad, RS No. 582-1, BL No. 1072 Paiki 1, TPS No. 66 (Kosad-Variyav), FP No. 327, Ashirwad Heights, Building No. J, 14th Floor, Flat No. 1404, Tal. Surat City (Adajan), Dist. Surat',
  },
  {
    label: 'Sayan plot (Rural NA)',
    text: 'Moje Sayan, RS No. 398, BL No. 581, Royal Residency, Plot No. 25/B, Tal. Olpad, Dist. Surat',
  },
];

export const FIELDS = [
  ['district', 'District'],
  ['taluka', 'Taluka'],
  ['village', 'Village / Moje'],
  ['tps', 'TPS No.'],
  ['fp', 'FP No.'],
  ['rsNo', 'RS / City Survey No.'],
  ['blNo', 'BL No.'],
];
