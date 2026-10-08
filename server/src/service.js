// The lookup as one service, shared by the chat screen (WebSocket) and the integration API.
//   property details -> which PDF -> strict lookup -> government value -> structured result
const { resolvePdf, KIND_LABEL } = require('./catalog');
const { downloadPdf } = require('./pdfSource');
const { openPdf } = require('./pdfIndex');
const { lookup, baseResult, PROPERTY_TYPES, RATE_UNIT } = require('./lookup');
const { normalizeUnit, toSqmt, governmentValue, UNIT_LABEL } = require('./valuation');

const AREA_TYPES = { corporation: 'CORPORATION', city: 'CORPORATION', nagarpalika: 'NAGARPALIKA', town: 'NAGARPALIKA', municipality: 'NAGARPALIKA', rural: 'RURAL_NA', ruralna: 'RURAL_NA', village: 'RURAL_NA' };
const AREA_TYPE_NAME = { CORPORATION: 'corporation', NAGARPALIKA: 'nagarpalika', RURAL_NA: 'rural', RURAL_AGRI: 'rural' };

const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());
const letters = (v) => clean(v).toLowerCase().replace(/[^a-z]/g, '');

// "Residential" + "Flat" -> flat, "Commercial" + "Shop" -> shop, ... Returns null when not recognised.
function normalizePropertyType(type, subType) {
  const t = letters(type);
  const s = letters(subType);
  const both = `${t} ${s}`;
  if (PROPERTY_TYPES[clean(type)]) return clean(type); // already one of the bot's own keys
  if (/flat|apartment/.test(both)) return 'flat';
  if (/shop|showroom/.test(both)) return 'shop';
  if (/office/.test(both)) return 'office';
  if (/agri/.test(t)) return /non|bin|un/.test(s) ? 'agri_non_irrigated' : /irrigat|piyat/.test(s) ? 'agri_irrigated' : 'agricultural';
  if (/industr|shed|factory/.test(t)) return 'industrial';
  if (/commerc/.test(t)) return 'commercial';
  if (/resident/.test(t)) return /plot|land|open/.test(s) ? 'residential' : 'residential_any';
  if (/plot|openland|land/.test(t)) return /industr/.test(s) ? 'industrial' : 'residential';
  return null;
}

// Area as { area, unit, areaSqmt, conversion }, null when none was given, or { error }.
function readArea(input) {
  const hasSqmt = clean(input.areaSqmt) !== '';
  const raw = hasSqmt ? input.areaSqmt : input.area;
  if (clean(raw) === '') return null;
  const area = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(area) || area <= 0) return { error: `Area "${raw}" is not a positive number.` };
  const picked = normalizeUnit(hasSqmt ? 'sqmt' : input.areaUnit);
  if (picked.error) return { error: picked.error };
  return { area, unit: picked.unit, unitLabel: UNIT_LABEL[picked.unit], ...toSqmt(area, picked.unit) };
}

// Turns a request body into the bot's query. Returns { q, area } or { errors: [...] }.
function readRequest(body = {}) {
  const errors = [];
  const state = clean(body.state);
  if (state && letters(state) !== 'gujarat') errors.push(`Only Gujarat is supported (state was "${state}").`);

  const q = {
    district: clean(body.district),
    taluka: clean(body.taluka),
    village: clean(body.village),
    tps: (clean(body.tpScheme ?? body.tps).match(/\d+/) || [''])[0], // "TPS-66", "66 (Kosad-Variyav)" -> 66
    fp: clean(body.fpNumber ?? body.fp),
    rsNo: clean(body.surveyNumber ?? body.rsNo),
    blNo: clean(body.blockNumber ?? body.blNo),
    propertyType: normalizePropertyType(body.propertyType, body.propertySubType),
    pdfType: '',
  };
  if (!q.district) errors.push('district is required.');
  if (!q.village) errors.push('village is required.');
  if (!clean(body.propertyType)) errors.push('propertyType is required.');
  else if (!q.propertyType) errors.push(`propertyType "${body.propertyType}" is not recognised. Use Residential, Commercial, Industrial, Agricultural, Flat, Shop, Office or Plot.`);
  if (!q.rsNo && !q.fp && !q.blNo) errors.push('Give surveyNumber, or tpScheme with fpNumber, or blockNumber.');
  if (q.tps && !q.fp && !q.rsNo) errors.push('Give fpNumber (or surveyNumber) together with tpScheme.');
  if (clean(body.tpScheme ?? body.tps) && !q.tps) errors.push(`tpScheme "${body.tpScheme ?? body.tps}" has no number in it.`);

  const areaType = letters(body.areaType ?? body.pdfType);
  if (areaType) {
    q.pdfType = AREA_TYPES[areaType] || '';
    if (!q.pdfType) errors.push(`areaType "${body.areaType ?? body.pdfType}" is not recognised. Use corporation, nagarpalika or rural.`);
  }

  const area = readArea(body);
  if (area && area.error) errors.push(area.error);
  return errors.length ? { errors } : { q, area };
}

// Adds the government value. Only a verified rate is ever multiplied.
function applyValuation(result, area) {
  result.area = area || null;
  result.valuation = null;
  if (area && result.status === 'verified') result.valuation = governmentValue(area.areaSqmt, result.rate);
  return result;
}

// A result for a request that never reached a PDF (unknown district, unreadable PDF, ...).
function failureResult(q, failure) {
  return Object.assign(baseResult(null, q, null), failure);
}

// Finds the rate without a browser. Returns { result, file } where file is the catalog entry searched (or null).
async function findRate(q, onProgress) {
  const resolved = resolvePdf(q);
  if (resolved.failure) return { result: failureResult(q, resolved.failure), file: null };
  q.pdfType = resolved.file.kind;
  const pdf = await downloadPdf(resolved.file.href);
  const doc = await openPdf(pdf.file);
  let result;
  try {
    result = await lookup(doc, pdf.file, q, pdf.name, onProgress);
  } finally {
    await doc.destroy();
  }
  result.notes.unshift(...resolved.notes);
  return { result, file: resolved.file };
}

// The structured answer returned by POST /api/jantri/lookup.
function toApiResponse({ result, file, shots = [], area, baseUrl = '' }) {
  const q = result.query;
  const absolute = (p) => (p ? `${baseUrl}${p}` : null);
  const main = shots[0] || null;
  const verified = result.status === 'verified';
  const out = {
    status: result.status,
    matchType: result.matchType,
    reason: result.reason,
    message: result.message,
    requiresManualVerification: !verified,
    state: 'Gujarat',
    district: file ? file.district : q.district,
    taluka: q.taluka || null,
    village: q.village,
    areaType: AREA_TYPE_NAME[q.pdfType] || null,
    surveyNumber: q.rsNo || null,
    tpScheme: q.tps || null,
    fpNumber: q.fp || null,
    blockNumber: q.blNo || null,
    propertyType: PROPERTY_TYPES[q.propertyType] || q.propertyType,
    jantriRate: verified ? result.rate : null,
    rateUnit: RATE_UNIT,
    rateCategory: verified ? result.rateLabel : null,
    jantriRatePerAcre: verified ? result.ratePerAcre : null, // agricultural tables only
    rateSource: 'Jantri (Annual Statement of Rates) 2011',
    areaSqmt: area ? Number(area.areaSqmt.toFixed(4)) : null,
    areaInput: area && area.unit !== 'sqmt' ? { value: area.area, unit: area.unit, conversion: area.conversion } : null,
    governmentValue: result.valuation ? result.valuation.governmentValue : null,
    formula: result.valuation ? result.valuation.formula : null,
    calculation: result.valuation ? result.valuation.calculation : null,
    matchedEntry: result.matched ? { field: result.matched.field, given: result.matched.value, printed: result.matched.found, listLabel: result.listLabel, zone: result.zone } : null,
    sourceDocument: result.pdf,
    sourceDocumentType: file ? KIND_LABEL[file.kind] : null,
    sourceUrl: file ? file.href : null,
    pageNumber: result.page,
    section: result.section,
    screenshotUrl: main ? absolute(main.url) : null,
    pageScreenshotUrl: main ? absolute(main.pageUrl) : null,
    evidenceChecked: verified ? Boolean(main && main.checked) : null,
    otherScreenshots: shots.slice(1).map((s) => ({ url: absolute(s.url), page: s.page, caption: s.caption })),
    candidates: result.candidates,
    suggestions: result.suggestions,
    notes: result.notes,
  };
  return out;
}

module.exports = { readRequest, readArea, applyValuation, failureResult, findRate, toApiResponse, normalizePropertyType };
