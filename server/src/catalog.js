// What each PDF on the website really contains (built by `npm run sync` from the PDFs themselves).
// The website's file names and labels are not reliable: e.g. amreli_corporation.pdf is a Nagarpalika
// file and Rajkot's corporation PDF sits in the Jamnagar row.
const fs = require('fs');
const path = require('path');

const { INDEX_DIR } = require('./config');
const { similarNames } = require('./lookup');
const { nameKey, splitSectionName } = require('./names');

const CATALOG_FILE = path.join(__dirname, '..', 'catalog.json');
const KIND_LABEL = { CORPORATION: 'Corporation', NAGARPALIKA: 'Nagarpalika', RURAL_NA: 'Rural NA', RURAL_AGRI: 'Rural Agri' };
const KIND_ORDER = ['CORPORATION', 'NAGARPALIKA', 'RURAL_NA'];

const key = (s) => String(s || '').toUpperCase().replace(/\(.*?\)/g, '').replace(/[^A-Z0-9]/g, '');

let cache = [];
let cacheTime = 0;
// re-read when `npm run sync` has written a newer catalog
function loadCatalog() {
  try {
    const { mtimeMs } = fs.statSync(CATALOG_FILE);
    if (mtimeMs !== cacheTime) {
      cache = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8')).files;
      cacheTime = mtimeMs;
    }
  } catch {
    cache = [];
    cacheTime = 0;
  }
  return cache;
}

function closeEnough(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 2 || Math.min(a.length, b.length) < 4) return false;
  // small spelling differences: Mehsana / Mahesana, Dangs / Dang
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 2) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 2;
}

// All PDFs of a district: by the district printed inside the PDF, else by the website's row name (Kutch = KACHCHH).
function filesForDistrict(district) {
  const want = key(district);
  if (!want) return [];
  const all = loadCatalog();
  const inRow = all.filter((f) => closeEnough(key(f.row), want));
  const unreadable = inRow.filter((f) => !f.kind);
  const inside = all.filter((f) => f.kind && closeEnough(key(f.district), want));
  if (inside.length) return [...inside, ...unreadable];
  // the website calls the district something else: use the name printed in that row's PDFs
  const printed = inRow.map((f) => f.district).filter(Boolean);
  const real = printed.sort((a, b) => printed.filter((d) => d === b).length - printed.filter((d) => d === a).length)[0];
  return [...all.filter((f) => f.kind && f.district === real), ...unreadable];
}

// Is the village (with its TPS, when one is given) a section of this PDF? Names must match exactly.
function hasVillage(file, q) {
  const village = key(q.village);
  if (!village) return false;
  const tps = q.tps ? String(Number(q.tps)) : null;
  return file.names.some((name) => {
    // village tables have no TP schemes, so a request with a TPS number is never about them
    if (file.kind === 'RURAL_NA' || file.kind === 'RURAL_AGRI') return !tps && nameKey(name) === village;
    if (nameKey(name) === village) return true; // the full section name as printed
    const section = splitSectionName(name);
    if (tps) return section.tps === tps && nameKey(section.village) === village;
    return nameKey(section.village) === village;
  });
}

const failure = (status, reason, message, extra = {}) => ({ failure: { status, reason, message, suggestions: [], candidates: [], ...extra } });
const manual = (type, description, extra = {}) => ({ type, description, requiresManualVerification: true, ...extra });

// Decides which PDF holds the property. Returns { file, notes }, or { failure } with the status to report.
// q.pdfType may be empty: then the PDF is the one (and only one) that lists the village.
function resolvePdf(q) {
  const files = filesForDistrict(q.district);
  if (!files.length) {
    return failure('not_found', 'district_not_found', `Exact Match Not Found: district "${q.district}" is not on the Jantri website.`,
      { suggestions: [manual('available_districts', districts().join(', '))] });
  }
  // a village has two tables: Rural NA for non-agricultural land, Rural Agri for agricultural land
  const agricultural = /^agri/.test(q.propertyType || '');
  const readable = files.filter((f) => f.kind && f.kind !== (agricultural ? 'RURAL_NA' : 'RURAL_AGRI'));
  if (agricultural && q.pdfType === 'RURAL_NA') q.pdfType = 'RURAL_AGRI';
  const unreadable = files.filter((f) => !f.kind);
  const unreadableNote = unreadable.length
    ? `${unreadable.map((f) => f.file).join(', ')} is published without readable text, so properties listed only there cannot be searched automatically.`
    : null;
  const notes = [];

  if (q.pdfType) {
    const file = readable.find((f) => f.kind === q.pdfType);
    if (!file) {
      const have = [...new Set(readable.map((f) => KIND_LABEL[f.kind]))].join(', ') || 'none';
      return failure('unsupported', unreadable.length ? 'document_not_readable' : 'document_not_available',
        `There is no readable ${KIND_LABEL[q.pdfType] || q.pdfType} PDF for ${q.district} (readable: ${have}).${unreadableNote ? ` ${unreadableNote}` : ''}`);
    }
    const elsewhere = readable.filter((f) => f !== file && hasVillage(f, q));
    if (!hasVillage(file, q) && elsewhere.length) {
      notes.push(`"${q.village}" is listed in the ${elsewhere.map((f) => KIND_LABEL[f.kind]).join(' and ')} PDF of this district.`);
    }
    return { file, notes };
  }

  const listing = readable.filter((f) => hasVillage(f, q));
  if (listing.length === 1) return { file: listing[0], notes };
  if (listing.length > 1) {
    return failure('ambiguous', 'village_in_several_documents',
      `Village "${q.village}" is listed in more than one PDF of ${q.district} (${listing.map((f) => KIND_LABEL[f.kind]).join(', ')}). Say which area type applies.`,
      { candidates: listing.map((f) => manual('area_type', KIND_LABEL[f.kind], { areaType: f.kind })) });
  }
  const near = similarNames(readable.flatMap((f) => f.names.flatMap((n) => [n, splitSectionName(n).village])), q.village);
  return failure('not_found', 'village_not_found',
    `Exact Match Not Found: village "${q.village}"${q.tps ? ` with TPS-${Number(q.tps)}` : ''} is not listed in any readable Jantri PDF of ${q.district}.${unreadableNote ? ` ${unreadableNote}` : ''}`,
    { suggestions: near.map((n) => manual('similar_village_name', n)) });
}

// Dropdown data for one district: each PDF kind with its talukas, villages and TPS numbers.
function places(district) {
  const files = filesForDistrict(district).filter((f) => f.kind && f.kind !== 'RURAL_AGRI') // listed under "village"
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return files.map((f) => {
    let index = [];
    try {
      index = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, `${f.file}.${f.kind}.json`), 'utf8'));
    } catch { /* index not built yet - run npm run sync */ }
    const talukas = new Map();
    for (const page of index) {
      if (!page.name) continue;
      // "KOSAD TPS-66" is offered as village KOSAD + TPS 66; any other name is offered whole, as printed
      const section = /^RURAL/.test(f.kind) ? { simple: false, tpScheme: false } : splitSectionName(page.name);
      const village = section.simple ? section.village : page.name;
      if (!talukas.has(page.taluka)) talukas.set(page.taluka, new Map());
      const villages = talukas.get(page.taluka);
      if (!villages.has(village)) villages.set(village, { name: village, tps: new Set(), plain: false, fpList: false });
      if (section.simple) villages.get(village).tps.add(section.tps);
      else villages.get(village).plain = true;
      if (!section.simple && section.tpScheme) villages.get(village).fpList = true; // a TP scheme section: numbers are FP numbers
    }
    return {
      kind: f.kind,
      label: KIND_LABEL[f.kind],
      district: f.district,
      talukas: [...talukas.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, villages]) => ({
        name,
        villages: [...villages.values()].sort((a, b) => a.name.localeCompare(b.name))
          .map((v) => ({ name: v.name, plain: v.plain, fpList: v.fpList, tps: [...v.tps].sort((a, b) => a - b) })),
      })),
    };
  });
}

function districts() {
  return [...new Set(loadCatalog().map((f) => f.row).filter(Boolean))];
}

module.exports = { CATALOG_FILE, KIND_LABEL, loadCatalog, resolvePdf, districts, places };
