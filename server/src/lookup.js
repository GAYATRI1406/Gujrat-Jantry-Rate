// Decision logic from 01-flow-logic-spec.md.
//   Flow A - Corporation PDF: TPS section -> FP No. -> rate column by property type
//   Flow B - Rural NA PDF:    village section -> RS No. -> BL No. -> Gamtal baseline rate
const { getIndex, parseCorpSection, parseNaSection } = require('./pdfIndex');

const NO_DATA = 'No data found';
const INSUFFICIENT = 'Insufficient data found';

const PROPERTY_TYPES = {
  flat: 'Flat / Apartment',
  shop: 'Shop',
  office: 'Office',
  residential: 'Open land / Plot - Residential',
  industrial: 'Open land - Industrial',
  commercial: 'Commercial',
};

const CORP_COLUMN_LABELS = {
  2: 'Open land (plot) rate',
  3: 'Residential flat / apartment',
  4: 'Office',
  5: 'Shop',
  6: 'Open land rate - industrial',
  7: 'Agricultural land - irrigated',
  8: 'Agricultural land - non irrigated',
};
const CORP_COLUMN_FOR_TYPE = { residential: 2, flat: 3, office: 4, shop: 5, industrial: 6 };
const NA_COLUMN_LABELS = { residential: 'Residential', commercial: 'Commercial', industrial: 'Industrial' };

const nameKey = (s) => String(s || '').toUpperCase().replace(/\(.*?\)/g, '').replace(/[^A-Z0-9]/g, '');
// some districts print numbers as "-/39" (nothing before the slash) - that is plain 39
const numKey = (s) => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/^-+\/?/, '').replace(/-/g, '/');
const baseNum = (s) => (numKey(s).match(/^\d+/) || [null])[0];

function splitSectionName(name) {
  const m = String(name).match(/^(.*?)\s*TPS\s*-?\s*0*(\d+)\s*$/i);
  return m ? { village: m[1].trim(), tps: m[2] } : { village: String(name).trim(), tps: null };
}

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

// Entries whose village matches; allows a small spelling difference (Kosad / Kosaad).
function matchVillage(entries, village, notes) {
  const want = nameKey(village);
  const exact = entries.filter((e) => nameKey(e.village) === want);
  if (exact.length || !want) return exact;
  // town sections are often named "ANAND-CITY", "DHORAJI-1", "JAMNAGAR (1) - JMC"
  const partial = entries.filter((e) => {
    const k = nameKey(e.village);
    return want.length >= 4 && k.length >= 4 && (k.startsWith(want) || want.startsWith(k));
  });
  if (partial.length) {
    notes.push(`No section is named exactly "${village}" - searched ${[...new Set(partial.map((e) => e.name))].slice(0, 8).join(', ')}.`);
    return partial;
  }
  let best = null;
  for (const key of new Set(entries.map((e) => nameKey(e.village)))) {
    const dist = editDistance(want, key);
    if (dist <= 2 && key.length > 4 && (!best || dist < best.dist)) best = { key, dist };
  }
  if (!best) return [];
  const close = entries.filter((e) => nameKey(e.village) === best.key);
  notes.push(`Village "${village}" is not spelled that way in the PDF - used the closest name "${close[0].village}".`);
  return close;
}

// Every place a number appears in the lists: exact text first, then same base number (582-1 ~ 582, 229 ~ 229/Paiki).
function findNumber(units, query) {
  const want = numKey(query);
  const hits = [];
  for (const how of ['exact', 'base']) {
    if (how === 'base' && !baseNum(query)) break;
    for (const unit of units) {
      for (const token of unit.tokens) {
        const ok = how === 'exact' ? numKey(token.s) === want : baseNum(token.s) === baseNum(query);
        if (ok && !hits.some((h) => h.unit === unit)) hits.push({ unit, token, how });
      }
    }
    if (hits.length) break;
  }
  return hits;
}

function rect(kind, x, w, top, bottom) {
  return { kind, x, w, top, bottom };
}

function evidenceFor(unit, token, value, { pageWidth, heads }, caption) {
  const out = [];
  const pages = [...new Set([token && token.page, value && value.page].filter(Boolean))];
  for (const page of pages) {
    const part = unit.parts.find((pt) => pt.page === page);
    const rects = [rect('block', 18, pageWidth - 36, part.top + 13, part.bottom - 7)];
    // the column titles of that page, so the screenshot shows what each rate means
    if (heads[page]) rects.push(rect('head', 18, pageWidth - 36, heads[page].top, heads[page].bottom));
    if (token && token.page === page) rects.push(rect('token', token.x - 2, token.w + 4, token.y + 10, token.y - 3));
    if (value && value.page === page) rects.push(rect('value', value.x - 3, value.w + 6, value.y + 10, value.y - 3));
    out.push({ page, rects, caption });
  }
  return out;
}

function baseResult(flow, q, pdfName) {
  return {
    flow, pdf: pdfName, status: 'no_data', message: NO_DATA, rate: null, rateLabel: null,
    section: null, sectionPages: [], page: null, zone: null, matched: null, values: {},
    notes: [], needsReview: false, searches: [], evidence: [],
    query: q,
  };
}

async function lookupCorporation(doc, file, q, pdfName, onProgress) {
  const res = baseResult('A', q, pdfName);
  const notes = res.notes;
  const index = (await getIndex(doc, file, q.pdfType, onProgress))
    .filter((e) => e.name)
    .map((e) => ({ ...e, ...splitSectionName(e.name) }));

  let entries;
  let searchKeys;
  if (q.tps) {
    const tps = String(Number(q.tps));
    const sameTps = index.filter((e) => e.tps === tps);
    entries = matchVillage(sameTps, q.village, notes);
    if (!entries.length && sameTps.length) {
      entries = sameTps;
      const names = [...new Set(sameTps.map((e) => e.name))].join(', ');
      notes.push(`TPS-${tps} is not listed under village "${q.village || '-'}" - searched ${names} instead.`);
      res.needsReview = true;
    }
    res.searches.push(`TPS-${tps.padStart(2, '0')}`);
    searchKeys = [['FP No.', q.fp]];
    if (!entries.length) {
      res.message = `${NO_DATA} - TPS-${tps} section is not in ${pdfName}`;
      return res;
    }
  } else {
    // No TPS number: the village's own section lists Survey No. / Block No. instead of FP No.
    entries = matchVillage(index.filter((e) => !e.tps), q.village, notes);
    searchKeys = [['RS No.', q.rsNo], ['BL No.', q.blNo], ['FP No.', q.fp]];
    res.searches.push(String(q.village || '').toUpperCase());
    if (!entries.length) {
      res.message = `${NO_DATA} - village "${q.village || '-'}" is not in ${pdfName}`;
      return res;
    }
  }

  res.section = [...new Set(entries.map((e) => e.name))].join(', ');
  res.sectionPages = entries.map((e) => e.p);
  const section = await parseCorpSection(doc, res.sectionPages);
  const { blocks } = section;

  let hits = [];
  let matched = null;
  for (const [field, value] of searchKeys) {
    if (!value) continue;
    res.searches.push(`${field} ${value}`);
    hits = findNumber(blocks, value);
    if (hits.length) {
      matched = { field, value, found: hits[0].token.s, how: hits[0].how };
      break;
    }
    notes.push(`${field} ${value} is not listed in ${res.section}.`);
  }

  // Fallback: the FP number just before and just after
  if (!hits.length && q.tps && q.fp && baseNum(q.fp)) {
    const n = Number(baseNum(q.fp));
    const before = findNumber(blocks, String(n - 1)).filter((h) => h.how === 'exact')[0];
    const after = findNumber(blocks, String(n + 1)).filter((h) => h.how === 'exact')[0];
    const pick = before || after;
    if (pick) {
      hits = [pick];
      matched = { field: 'FP No.', value: q.fp, found: pick.token.s, how: 'neighbour' };
      notes.push(`Used neighbouring FP No. ${pick.token.s} (zone ${pick.unit.zone || '-'}) as the fallback.`);
      if (before && after && before.unit !== after.unit) {
        notes.push(`FP No. ${n - 1} (zone ${before.unit.zone}) and FP No. ${n + 1} (zone ${after.unit.zone}) are in different zones - check which one applies.`);
        res.needsReview = true;
      }
    }
  }

  if (!hits.length) {
    res.message = `${NO_DATA} - number not listed in ${res.section}`;
    return res;
  }

  const { unit: block, token } = hits[0];
  if (hits.length > 1) {
    notes.push(`${matched.field} ${matched.value} is also listed in zone ${hits.slice(1).map((h) => h.unit.zone).join(', ')} - used the first one.`);
    res.needsReview = true;
  }
  if (matched.how === 'base') notes.push(`Matched "${token.s}" in the PDF by its base number.`);

  res.matched = matched;
  res.zone = block.zone;
  res.page = token.page;
  for (const [col, cell] of Object.entries(block.values)) res.values[CORP_COLUMN_LABELS[col]] = cell.v;

  // Pick the rate column for the property type
  const type = q.propertyType;
  let col = CORP_COLUMN_FOR_TYPE[type];
  if (type === 'industrial' && !block.values[6] && block.values[2]) {
    col = 2;
    notes.push('Open land industrial value is empty - used the open land residential value instead.');
  }
  if (!col) notes.push(`This table has no "${PROPERTY_TYPES[type] || type}" column - choose Shop, Office, Flat or Open land.`);
  const cell = col ? block.values[col] : null;
  if (cell) {
    res.status = matched.how === 'neighbour' || col !== CORP_COLUMN_FOR_TYPE[type] ? 'fallback' : 'found';
    res.rate = cell.v;
    res.rateLabel = CORP_COLUMN_LABELS[col];
    res.message = `Rs. ${cell.v} per sq. mt.`;
  } else if (col) {
    notes.push(`The "${CORP_COLUMN_LABELS[col]}" cell is empty for zone ${block.zone}.`);
  }
  res.evidence = evidenceFor(block, token, cell, section, `Zone ${block.zone} - ${block.label || res.section}`);
  return res;
}

async function lookupRuralNa(doc, file, q, pdfName, onProgress) {
  const res = baseResult('B', q, pdfName);
  const notes = res.notes;
  const index = (await getIndex(doc, file, 'RURAL_NA', onProgress))
    .filter((e) => e.name)
    .map((e) => ({ ...e, village: e.name }));

  let entries = matchVillage(index, q.village, notes);
  const inTaluka = entries.filter((e) => nameKey(e.taluka) === nameKey(q.taluka));
  if (inTaluka.length) entries = inTaluka;
  else if (new Set(entries.map((e) => e.taluka)).size > 1) {
    notes.push(`Village "${q.village}" exists in more than one taluka and taluka "${q.taluka || '-'}" did not match - used ${entries[0].taluka}.`);
    entries = entries.filter((e) => e.taluka === entries[0].taluka);
    res.needsReview = true;
  }
  res.searches.push(String(q.village || '').toUpperCase());
  if (!entries.length) {
    res.message = `${NO_DATA} - village "${q.village || '-'}" is not in ${pdfName}`;
    return res;
  }

  res.section = `${entries[0].village} (Taluka ${entries[0].taluka}, District ${entries[0].district})`;
  res.sectionPages = entries.map((e) => e.p);
  const section = await parseNaSection(doc, res.sectionPages);
  const { rows, header, pageWidth } = section;
  const type = q.propertyType;

  let hits = [];
  let matched = null;
  for (const [field, value] of [['RS No.', q.rsNo], ['BL No.', q.blNo]]) {
    if (!value) continue;
    res.searches.push(`${field} ${value}`);
    hits = findNumber(rows, value);
    if (hits.length) {
      matched = { field, value, found: hits[0].token.s, how: hits[0].how };
      break;
    }
    notes.push(`${field} ${value} is not listed for ${entries[0].village}.`);
  }

  if (!hits.length) {
    // Last resort: the village baseline (Gamtal) rate printed at the top of the section
    if (!header) return res;
    const key = type === 'commercial' && header.gamtal.commercial ? 'commercial' : 'residential';
    const cell = header.gamtal[key];
    res.page = header.page;
    for (const [k, c] of Object.entries(header.gamtal)) res.values[`Gamtal ${NA_COLUMN_LABELS[k]}`] = c.v;
    res.matched = { field: 'Village baseline', value: entries[0].village, found: `Gamtal ${NA_COLUMN_LABELS[key]}`, how: 'gamtal' };
    const rects = [rect('block', 18, pageWidth - 36, header.top + 16, header.bottom - 8)];
    if (cell) rects.push(rect('value', cell.x - 3, cell.w + 6, cell.y + 10, cell.y - 3));
    res.evidence = [{ page: header.page, rects, caption: `${entries[0].village} - Gamtal baseline rate` }];
    if (['flat', 'shop', 'office'].includes(type)) {
      res.status = 'insufficient';
      res.message = INSUFFICIENT;
    } else if (cell) {
      res.status = 'fallback';
      res.rate = cell.v;
      res.rateLabel = `Gamtal ${NA_COLUMN_LABELS[key]} (village baseline)`;
      res.message = `Rs. ${cell.v} per sq. mt.`;
      notes.push('Neither RS No. nor BL No. matched - used the village baseline (Gamtal) rate.');
    }
    return res;
  }

  const { unit: row, token } = hits[0];
  if (hits.length > 1) {
    notes.push(`${matched.field} ${matched.value} appears in ${hits.length} rows - used the first one.`);
    res.needsReview = true;
  }
  if (matched.how === 'base') notes.push(`Matched "${token.s}" in the PDF by its base number.`);
  res.matched = matched;
  res.page = token.page;
  for (const [k, c] of Object.entries(row.values)) res.values[NA_COLUMN_LABELS[k]] = c.v;

  let cell = null;
  if (['flat', 'shop', 'office'].includes(type)) {
    res.status = 'insufficient';
    res.message = INSUFFICIENT;
    notes.push(`The Rural NA table only has Residential / Commercial / Industrial columns - no rate for ${PROPERTY_TYPES[type]}.`);
  } else {
    cell = row.values[type] || null;
    if (cell) {
      res.status = 'found';
      res.rate = cell.v;
      res.rateLabel = NA_COLUMN_LABELS[type];
      res.message = `Rs. ${cell.v} per sq. mt.`;
    } else {
      notes.push(`The "${NA_COLUMN_LABELS[type] || type}" cell is empty for this row.`);
    }
  }
  res.evidence = evidenceFor(row, token, cell, section, `${entries[0].village} - ${matched.field} ${token.s}`);
  return res;
}

async function lookup(doc, file, q, pdfName, onProgress) {
  // Corporation and Nagarpalika PDFs use the same table, so both go through Flow A
  if (q.pdfType === 'RURAL_NA') return lookupRuralNa(doc, file, q, pdfName, onProgress);
  return lookupCorporation(doc, file, q, pdfName, onProgress);
}

module.exports = { lookup, PROPERTY_TYPES, nameKey };
