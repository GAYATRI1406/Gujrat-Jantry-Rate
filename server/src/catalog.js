// What each PDF on the website really contains (built by `npm run sync` from the PDFs themselves).
// The website's file names and labels are not reliable: e.g. amreli_corporation.pdf is a Nagarpalika
// file and Rajkot's corporation PDF sits in the Jamnagar row.
const fs = require('fs');
const path = require('path');

const { INDEX_DIR } = require('./config');

const CATALOG_FILE = path.join(__dirname, '..', 'catalog.json');
const KIND_LABEL = { CORPORATION: 'Corporation', NAGARPALIKA: 'Nagarpalika', RURAL_NA: 'Rural NA' };
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

function hasVillage(file, q) {
  const village = key(q.village);
  if (!village) return false;
  const tps = q.tps ? String(Number(q.tps)) : null;
  return file.names.some((name) => {
    const m = name.match(/^(.*?)\s*TPS\s*-?\s*0*(\d+)\s*$/i);
    if (file.kind !== 'RURAL_NA' && tps) return m && m[2] === tps && key(m[1]) === village;
    const section = key(m ? m[1] : name);
    return section === village || (file.kind !== 'RURAL_NA' && section.startsWith(village));
  });
}

// Chooses the PDF for a query. Returns { file, notes } or throws with a clear reason.
function choosePdf(q) {
  const files = filesForDistrict(q.district);
  const readable = files.filter((f) => f.kind);
  const unreadable = files.filter((f) => !f.kind);
  const notes = [];
  if (!files.length) {
    const known = [...new Set(loadCatalog().map((f) => f.row).filter(Boolean))].join(', ');
    throw new Error(`District "${q.district}" is not on the website. Districts available: ${known}.`);
  }

  const order = [q.pdfType, ...KIND_ORDER.filter((k) => k !== q.pdfType)];
  const ranked = order.flatMap((kind) => readable.filter((f) => f.kind === kind));
  const withVillage = ranked.filter((f) => hasVillage(f, q));
  let file = withVillage[0] || ranked.find((f) => f.kind === q.pdfType);

  if (file && file.kind !== q.pdfType) {
    notes.push(`"${q.village}" is not in the ${KIND_LABEL[q.pdfType] || q.pdfType} PDF of ${q.district} - it is in the ${KIND_LABEL[file.kind]} PDF, so that one was searched.`);
  }
  if (!file) {
    const have = [...new Set(readable.map((f) => KIND_LABEL[f.kind]))].join(', ') || 'none';
    const blocked = unreadable.length ? ` ${unreadable.map((f) => f.file).join(', ')} is on the website but its text cannot be read by a program.` : '';
    throw new Error(`There is no readable ${KIND_LABEL[q.pdfType] || q.pdfType} PDF for ${q.district} (available: ${have}).${blocked}`);
  }
  return { file, notes };
}

// Dropdown data for one district: each PDF kind with its talukas, villages and TPS numbers.
function places(district) {
  const files = filesForDistrict(district).filter((f) => f.kind)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return files.map((f) => {
    let index = [];
    try {
      index = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, `${f.file}.${f.kind}.json`), 'utf8'));
    } catch { /* index not built yet - run npm run sync */ }
    const talukas = new Map();
    for (const page of index) {
      if (!page.name) continue;
      const m = f.kind === 'RURAL_NA' ? null : page.name.match(/^(.*?)\s*TPS\s*-?\s*0*(\d+)\s*$/i);
      const village = m ? m[1].trim() : page.name;
      if (!talukas.has(page.taluka)) talukas.set(page.taluka, new Map());
      const villages = talukas.get(page.taluka);
      if (!villages.has(village)) villages.set(village, { name: village, tps: new Set(), plain: false });
      if (m) villages.get(village).tps.add(m[2]);
      else villages.get(village).plain = true;
    }
    return {
      kind: f.kind,
      label: KIND_LABEL[f.kind],
      district: f.district,
      talukas: [...talukas.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, villages]) => ({
        name,
        villages: [...villages.values()].sort((a, b) => a.name.localeCompare(b.name))
          .map((v) => ({ name: v.name, plain: v.plain, tps: [...v.tps].sort((a, b) => a - b) })),
      })),
    };
  });
}

function districts() {
  return [...new Set(loadCatalog().map((f) => f.row).filter(Boolean))];
}

module.exports = { CATALOG_FILE, KIND_LABEL, loadCatalog, choosePdf, districts, places };
