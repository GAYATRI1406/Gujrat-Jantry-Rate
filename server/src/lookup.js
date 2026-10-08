// Strict Jantri lookup (Task 2). Accuracy comes first:
//   - a rate is "verified" only when the given number is listed exactly once in the right village
//     section, in the right kind of list, and the rate cell for the property type is filled
//   - anything else returns no rate; near misses are offered only as suggestions that need manual checking
//
//   Flow A - Corporation / Nagarpalika PDF: village (+ TPS) section -> FP No. or Survey No. -> rate column
//   Flow B - Rural NA PDF:                  village section -> Survey No. -> rate column
//   Flow C - Rural Agri PDF:                village section -> Survey No. -> irrigated / non-irrigated rate
const { getIndex, parseCorpSection, parseNaSection, parseAgriSection } = require('./pdfIndex');
const { nameKey, splitSectionName } = require('./names');

const NOT_FOUND = 'Exact Match Not Found';
const RATE_UNIT = 'sqmt';

const PROPERTY_TYPES = {
  flat: 'Flat / Apartment',
  shop: 'Shop',
  office: 'Office',
  residential: 'Residential plot / open land',
  commercial: 'Commercial',
  industrial: 'Industrial plot / land',
  agri_irrigated: 'Agricultural - irrigated',
  agri_non_irrigated: 'Agricultural - non irrigated',
  // general words an API caller may send; they need a more specific type in city / town tables
  residential_any: 'Residential',
  agricultural: 'Agricultural',
};

const URBAN_COLUMNS = {
  2: 'Open plot (land) rate',
  3: 'Residential flat / apartment',
  4: 'Office',
  5: 'Shop',
  6: 'Open plot rate - industrial',
  7: 'Agricultural land - irrigated',
  8: 'Agricultural land - non irrigated',
};
// which rate column(s) a property type can mean; more than one = the type is too general to verify
const URBAN_COLUMNS_FOR_TYPE = {
  flat: [3], office: [4], shop: [5], residential: [2], industrial: [6],
  agri_irrigated: [7], agri_non_irrigated: [8],
  residential_any: [2, 3], commercial: [4, 5], agricultural: [7, 8],
};
const RURAL_COLUMNS = { residential: 'Residential', commercial: 'Commercial', industrial: 'Industrial' };
const RURAL_COLUMNS_FOR_TYPE = {
  residential: ['residential'], residential_any: ['residential'], commercial: ['commercial'], industrial: ['industrial'],
};
const AGRI_COLUMNS = {
  non_irrigated: 'Agricultural land - non irrigated', irrigated: 'Agricultural land - irrigated',
  kharaba: 'Uncultivable land (kharaba)', mineral: 'Mineral-bearing land',
};
const AGRI_COLUMNS_FOR_TYPE = {
  agri_non_irrigated: ['non_irrigated'], agri_irrigated: ['irrigated'], agricultural: ['non_irrigated', 'irrigated'],
};
// the two village tables: non-agricultural land (Rural NA) and agricultural land (Rural Agri)
const RURAL_TABLES = {
  RURAL_NA: { flow: 'B', parse: parseNaSection, columns: RURAL_COLUMNS, columnsForType: RURAL_COLUMNS_FOR_TYPE },
  RURAL_AGRI: { flow: 'C', parse: parseAgriSection, columns: AGRI_COLUMNS, columnsForType: AGRI_COLUMNS_FOR_TYPE },
};

const FIELD_LABEL = { fp: 'FP No.', rsNo: 'Survey No.', blNo: 'Block No.' };

// "582-1" and "582/1" are the same number; "-/39" (nothing before the slash) is plain 39; 066 is 66
const numKey = (s) => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/^-+\/?/, '').replace(/-/g, '/')
  .replace(/(^|\/)0+(?=\d)/g, '$1');
const baseNum = (s) => (numKey(s).match(/^\d+/) || [null])[0];


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

// Names in the PDF that look like what was typed. Offered as "did you mean", never used on their own.
function similarNames(names, village) {
  const want = nameKey(village);
  if (want.length < 3) return [];
  return [...new Set(names)].filter((n) => {
    const k = nameKey(n);
    return k !== want && (k.startsWith(want) || want.startsWith(k) || editDistance(want, k) <= 2);
  }).slice(0, 8);
}

// What kind of number a list in a city / town PDF holds, from the label printed above it.
function listType(label) {
  if (/block/i.test(label)) return 'block';
  if (/F\.?\s*P|final/i.test(label)) return 'fp';
  if (/survey|S\.?\s*NO|R\.?\s*S/i.test(label)) return 'survey';
  return 'unknown';
}
const LIST_FOR_FIELD = { fp: 'fp', rsNo: 'survey', blNo: 'block' };

// Units (blocks or rows) that list the number. mode 'exact' = same number; 'base' = same number before any /part.
function unitsListing(units, query, mode, accept = () => true) {
  const want = mode === 'exact' ? numKey(query) : baseNum(query);
  if (!want) return [];
  const hits = [];
  for (const unit of units) {
    if (!accept(unit)) continue;
    const inRun = (t) => mode === 'exact' && t.range && /^\d+$/.test(want) && Number(want) >= t.range[0] && Number(want) <= t.range[1];
    const token = unit.tokens.find((t) => (mode === 'exact' ? numKey(t.s) === want || inRun(t) : !t.range && baseNum(t.s) === want && numKey(t.s) !== numKey(query)));
    if (token) hits.push({ unit, token });
  }
  return hits;
}

function rect(kind, x, w, top, bottom) {
  return { kind, x, w, top, bottom };
}

function evidenceFor(unit, token, value, { pageWidth, heads }, caption, role) {
  const out = [];
  const pages = [...new Set([token && token.page, value && value.page].filter(Boolean))];
  for (const page of pages) {
    const part = unit.parts.find((pt) => pt.page === page);
    const rects = [rect('block', 18, pageWidth - 36, part.top + 13, part.bottom - 7)];
    // the column titles of that page, so the screenshot shows what each rate means
    if (heads[page]) rects.push(rect('head', 18, pageWidth - 36, heads[page].top, heads[page].bottom));
    if (token && token.page === page) rects.push(rect('token', token.x - 2, token.w + 4, token.y + 10, token.y - 3));
    if (value && value.page === page) rects.push(rect('value', value.x - 3, value.w + 6, value.y + 10, value.y - 3));
    out.push({ page, rects, caption, role, expect: value && value.page === page ? value.v : null });
  }
  return out;
}

function baseResult(flow, q, pdfName) {
  return {
    flow, pdf: pdfName, status: 'not_found', matchType: 'none', reason: null, message: NOT_FOUND,
    rate: null, rateLabel: null, rateUnit: RATE_UNIT, ratePerAcre: null,
    section: null, sectionPages: [], page: null, zone: null, listLabel: null, matched: null, values: {},
    notes: [], suggestions: [], candidates: [], searches: [], evidence: [],
    query: q,
  };
}

const fail = (res, status, reason, message) => Object.assign(res, { status, reason, message });

// A near miss, shown to the user as something to check by hand. Never returned as the property's rate.
function suggestion(type, description, hit, rates, columnsForType, columnLabels, type_) {
  const cols = columnsForType[type_] || [];
  const cell = cols.length === 1 ? rates[cols[0]] : null;
  return {
    type, description, requiresManualVerification: true,
    matchedText: hit ? hit.token.s : null,
    zone: hit ? hit.unit.zone || null : null,
    page: hit ? hit.token.page : null,
    rate: cell ? cell.v : null,
    rateCategory: cell ? columnLabels[cols[0]] : null,
    rates: Object.fromEntries(Object.entries(rates).map(([k, c]) => [columnLabels[k], c.v])),
  };
}

// After the row is identified: pick the rate cell for the property type, or say exactly why it cannot be verified.
function settleRate(res, unit, token, q, columnsForType, columnLabels, section, caption) {
  const type = q.propertyType;
  const cols = columnsForType[type];
  for (const [k, cell] of Object.entries(unit.values)) res.values[columnLabels[k]] = cell.v;
  res.matchType = 'exact';
  res.page = token.page;
  res.zone = unit.zone || null;
  res.listLabel = unit.label || null;

  if (!cols || !cols.length) {
    fail(res, 'unsupported', 'property_type_not_in_table',
      `The entry was found, but this table has no rate for "${PROPERTY_TYPES[type] || type}". It lists: ${Object.values(columnLabels).join(', ')}.`);
    res.evidence = evidenceFor(unit, token, null, section, caption, 'match');
    return res;
  }
  if (cols.length > 1) {
    fail(res, 'ambiguous', 'property_type_too_general',
      `The entry was found, but "${PROPERTY_TYPES[type] || type}" can mean more than one rate here. Choose one: ${cols.map((c) => columnLabels[c]).join(' / ')}.`);
    res.candidates = cols.map((c) => ({
      type: 'rate_category', description: columnLabels[c], requiresManualVerification: true,
      matchedText: token.s, zone: unit.zone || null, page: token.page,
      rate: unit.values[c] ? unit.values[c].v : null, rateCategory: columnLabels[c],
    }));
    res.evidence = evidenceFor(unit, token, null, section, caption, 'match');
    return res;
  }

  const cell = unit.values[cols[0]] || null;
  if (!cell) {
    fail(res, 'rate_not_available', 'rate_cell_empty',
      `The entry was found, but the "${columnLabels[cols[0]]}" rate is blank in the PDF for this entry.`);
    // the old automatic fallback (industrial -> open plot) is now only a suggestion
    if (type === 'industrial' && unit.values[2]) {
      res.suggestions.push({
        type: 'other_rate_column', requiresManualVerification: true,
        description: `The open plot rate of the same entry is ${unit.values[2].v}. It is not the industrial rate.`,
        matchedText: token.s, zone: unit.zone || null, page: token.page, rate: unit.values[2].v, rateCategory: columnLabels[2],
      });
    }
    res.evidence = evidenceFor(unit, token, null, section, caption, 'match');
    return res;
  }

  res.status = 'verified';
  res.reason = null;
  res.rate = cell.v;
  res.ratePerAcre = cell.acre || null; // agricultural tables print the rate per acre as well
  if (token.range) res.notes.push(`The number is listed inside the run "${token.s}" (${token.range[0]} to ${token.range[1]}).`);
  res.rateLabel = columnLabels[cols[0]];
  res.message = `Verified: Rs. ${cell.v} per sq. mt. (${res.rateLabel})`;
  res.evidence = evidenceFor(unit, token, cell, section, caption, 'match');
  return res;
}

// More than one entry lists the number: nothing is verified, every place is reported.
function settleAmbiguous(res, hits, field, value, q, columnsForType, columnLabels, section) {
  fail(res, 'ambiguous', 'multiple_entries',
    `${FIELD_LABEL[field]} ${value} is listed ${hits.length} times in ${res.section}. The correct entry must be chosen by hand.`);
  res.matchType = 'multiple';
  res.candidates = hits.map((h) => suggestion('duplicate_entry',
    `${FIELD_LABEL[field]} ${h.token.s}${h.unit.zone ? ` in zone ${h.unit.zone}` : ''}${h.unit.label ? ` (${h.unit.label})` : ''}, page ${h.token.page}`,
    h, h.unit.values, columnsForType, columnLabels, q.propertyType));
  res.evidence = hits.slice(0, 3).flatMap((h) => evidenceFor(h.unit, h.token, null, section,
    `Candidate - ${FIELD_LABEL[field]} ${h.token.s}${h.unit.zone ? `, zone ${h.unit.zone}` : ''}`, 'candidate').slice(0, 1));
  return res;
}

// The exact number was found once, but parts of the same number (229/Paiki, 582/1) are listed elsewhere.
// The exact entry stays verified; the related ones are pointed out so the user can check which applies.
function noteRelated(res, related, hit, label) {
  const others = related.filter((r) => r.unit !== hit.unit).slice(0, 4);
  if (!others.length) return;
  res.notes.push(`${label} ${hit.token.s} is matched exactly. Related entries are also listed: ${others.map((r) => `${r.token.s} (page ${r.token.page}${r.unit.zone ? `, zone ${r.unit.zone}` : ''})`).join(', ')}. Check that the property is not one of those parts.`);
}

// Taluka check shared by both flows: a village name that exists in several talukas needs the right taluka.
function narrowByTaluka(res, entries, q) {
  const talukas = [...new Set(entries.map((e) => e.taluka))];
  if (talukas.length > 1) {
    const mine = entries.filter((e) => nameKey(e.taluka) === nameKey(q.taluka));
    if (!mine.length) {
      fail(res, 'ambiguous', 'village_in_several_talukas',
        `Village "${q.village}" exists in more than one taluka (${talukas.join(', ')}). Give the taluka exactly as listed.`);
      res.candidates = talukas.map((t) => ({ type: 'taluka', description: t, requiresManualVerification: true }));
      return null;
    }
    return mine;
  }
  if (q.taluka && nameKey(q.taluka) !== nameKey(talukas[0])) {
    res.notes.push(`The PDF lists this village under taluka ${talukas[0]} (you gave "${q.taluka}").`);
  }
  return entries;
}

async function lookupUrban(doc, file, q, pdfName, onProgress) {
  const res = baseResult('A', q, pdfName);
  const index = (await getIndex(doc, file, q.pdfType, onProgress))
    .filter((e) => e.name)
    .map((e) => ({ ...e, ...splitSectionName(e.name) }));
  const want = nameKey(q.village);
  const tps = q.tps ? String(Number(q.tps)) : null;
  const ofVillage = index.filter((e) => nameKey(e.village) === want);
  // the full section name as printed (what the dropdowns send, and the only way to name most Ahmedabad sections)
  const byFullName = index.filter((e) => nameKey(e.name) === want);

  let entries;
  let field;
  if (byFullName.length && !(tps && ofVillage.some((e) => e.tps === tps))) {
    entries = byFullName;
    field = q.fp && (byFullName[0].tpScheme || !q.rsNo) ? 'fp' : q.rsNo ? 'rsNo' : 'blNo';
    res.searches.push(String(q.village || '').toUpperCase());
  } else if (tps) {
    entries = ofVillage.filter((e) => e.tps === tps);
    // a TPS section normally lists FP numbers, but a few list survey numbers (e.g. Khoraj TPS-63)
    field = q.fp ? 'fp' : 'rsNo';
    res.searches.push(`TPS-${tps.padStart(2, '0')}`);
    if (!entries.length) {
      const elsewhere = [...new Set(index.filter((e) => e.tps === tps).map((e) => e.name))];
      const mine = [...new Set(ofVillage.filter((e) => e.tps).map((e) => `TPS-${e.tps}`))];
      fail(res, 'not_found', ofVillage.length ? 'tps_not_in_village' : 'village_not_found',
        `${NOT_FOUND}: there is no section for village "${q.village}" with TPS-${tps} in ${pdfName}.`);
      if (mine.length) res.suggestions.push({ type: 'tps_of_village', requiresManualVerification: true, description: `Village ${q.village} has these TP schemes: ${mine.join(', ')}.` });
      if (elsewhere.length) res.suggestions.push({ type: 'tps_in_other_village', requiresManualVerification: true, description: `TPS-${tps} is listed under: ${elsewhere.join(', ')}.` });
      for (const n of similarNames(index.map((e) => e.village), q.village)) res.suggestions.push({ type: 'similar_village_name', requiresManualVerification: true, description: n });
      return res;
    }
  } else {
    entries = ofVillage.filter((e) => !e.tps);
    field = q.rsNo ? 'rsNo' : q.fp ? 'fp' : 'blNo';
    res.searches.push(String(q.village || '').toUpperCase());
    if (!entries.length) {
      const mine = [...new Set(ofVillage.map((e) => `TPS-${e.tps}`))];
      fail(res, 'not_found', mine.length ? 'tps_required' : 'village_not_found', mine.length
        ? `${NOT_FOUND}: village "${q.village}" is listed only under TP schemes (${mine.join(', ')}). Give the TPS No. and FP No.`
        : `${NOT_FOUND}: village "${q.village}" is not listed in ${pdfName}.`);
      for (const n of similarNames(index.map((e) => e.village), q.village)) res.suggestions.push({ type: 'similar_village_name', requiresManualVerification: true, description: n });
      return res;
    }
  }

  entries = narrowByTaluka(res, entries, q);
  if (!entries) return res;

  res.section = [...new Set(entries.map((e) => e.name))].join(', ');
  res.sectionPages = entries.map((e) => e.p);
  const section = await parseCorpSection(doc, res.sectionPages);
  const { blocks } = section;
  const value = q[field];
  res.searches.push(`${FIELD_LABEL[field]} ${value}`);

  // only lists of the right kind count: an FP number is not looked up in a Survey No. list, and so on
  const wantList = LIST_FOR_FIELD[field];
  const rightList = (b) => [wantList, 'unknown'].includes(listType(b.label));
  const hits = unitsListing(blocks, value, 'exact', rightList);
  const caption = (h) => `Zone ${h.unit.zone || '-'} - ${h.unit.label || res.section}`;
  const suggest = (type, text, h) => suggestion(type, text, h, h.unit.values, URBAN_COLUMNS_FOR_TYPE, URBAN_COLUMNS, q.propertyType);

  if (hits.length === 1) {
    res.matched = { field: FIELD_LABEL[field], value, found: hits[0].token.s };
    noteRelated(res, unitsListing(blocks, value, 'base', rightList), hits[0], FIELD_LABEL[field]);
    return settleRate(res, hits[0].unit, hits[0].token, q, URBAN_COLUMNS_FOR_TYPE, URBAN_COLUMNS, section, caption(hits[0]));
  }
  if (hits.length > 1) return settleAmbiguous(res, hits, field, value, q, URBAN_COLUMNS_FOR_TYPE, URBAN_COLUMNS, section);

  // ---- no exact match: report it, and offer near misses as suggestions only ----
  fail(res, 'not_found', 'number_not_found', `${NOT_FOUND}: ${FIELD_LABEL[field]} ${value} is not listed in ${res.section}.`);
  const kinds = [...new Set(blocks.map((b) => listType(b.label)).filter((k) => k !== 'unknown'))];
  if (kinds.length && !kinds.includes(wantList)) {
    const names = { fp: 'FP numbers', survey: 'survey numbers', block: 'block numbers' };
    res.notes.push(`This section lists ${kinds.map((k) => names[k]).join(' and ')}, not ${names[wantList]}. Search with that number instead.`);
  }
  for (const h of unitsListing(blocks, value, 'exact', (b) => !rightList(b))) {
    res.suggestions.push(suggest('listed_under_other_label', `The number ${h.token.s} appears in a "${h.unit.label}" list (zone ${h.unit.zone || '-'}), which is a different kind of number.`, h));
  }
  for (const h of unitsListing(blocks, value, 'base', rightList).slice(0, 5)) {
    res.suggestions.push(suggest('similar_number', `${FIELD_LABEL[field]} ${h.token.s} is listed (zone ${h.unit.zone || '-'}), not ${value}.`, h));
  }
  if (field === 'fp' && tps && /^\d+$/.test(numKey(value))) {
    for (const n of [Number(value) - 1, Number(value) + 1]) {
      for (const h of unitsListing(blocks, String(n), 'exact', rightList).slice(0, 1)) {
        res.suggestions.push(suggest('neighbouring_fp', `Neighbouring FP No. ${h.token.s} is in zone ${h.unit.zone || '-'}. It is a different plot.`, h));
      }
    }
  }
  for (const other of ['rsNo', 'blNo', 'fp'].filter((f) => f !== field && q[f])) {
    const type = LIST_FOR_FIELD[other];
    for (const h of unitsListing(blocks, q[other], 'exact', (b) => [type, 'unknown'].includes(listType(b.label))).slice(0, 2)) {
      res.suggestions.push(suggest('other_identifier', `${FIELD_LABEL[other]} ${h.token.s} is listed in zone ${h.unit.zone || '-'}.`, h));
    }
  }
  const first = res.suggestions.find((s) => s.page);
  if (first) {
    const h = [...blocks].flatMap((b) => b.tokens.filter((t) => t.s === first.matchedText && t.page === first.page).map((token) => ({ unit: b, token })))[0];
    if (h) res.evidence = evidenceFor(h.unit, h.token, null, section, `Suggestion only, not verified - ${first.matchedText}`, 'suggestion').slice(0, 1);
  }
  return res;
}

async function lookupRural(doc, file, q, pdfName, onProgress) {
  const table = RURAL_TABLES[q.pdfType];
  const res = baseResult(table.flow, q, pdfName);
  const index = (await getIndex(doc, file, q.pdfType, onProgress))
    .filter((e) => e.name)
    .map((e) => ({ ...e, village: e.name }));

  let entries = index.filter((e) => nameKey(e.village) === nameKey(q.village));
  res.searches.push(String(q.village || '').toUpperCase());
  if (!entries.length) {
    fail(res, 'not_found', 'village_not_found', `${NOT_FOUND}: village "${q.village}" is not listed in ${pdfName}.`);
    for (const n of similarNames(index.map((e) => e.village), q.village)) res.suggestions.push({ type: 'similar_village_name', requiresManualVerification: true, description: n });
    return res;
  }
  entries = narrowByTaluka(res, entries, q);
  if (!entries) return res;


  res.section = `${entries[0].village} (Taluka ${entries[0].taluka}, District ${entries[0].district})`;
  res.sectionPages = entries.map((e) => e.p);
  const section = await table.parse(doc, res.sectionPages);
  const { rows, header, pageWidth } = section;
  const suggest = (type, text, h) => suggestion(type, text, h, h.unit.values, table.columnsForType, table.columns, q.propertyType);

  // the village table is a list of survey numbers, so only the survey number can verify a rate
  if (q.rsNo) {
    res.searches.push(`${FIELD_LABEL.rsNo} ${q.rsNo}`);
    const hits = unitsListing(rows, q.rsNo, 'exact');
    if (hits.length === 1) {
      res.matched = { field: FIELD_LABEL.rsNo, value: q.rsNo, found: hits[0].token.s };
      noteRelated(res, unitsListing(rows, q.rsNo, 'base'), hits[0], FIELD_LABEL.rsNo);
      return settleRate(res, hits[0].unit, hits[0].token, q, table.columnsForType, table.columns, section, `${entries[0].village} - Survey No. ${hits[0].token.s}`);
    }
    if (hits.length > 1) return settleAmbiguous(res, hits, 'rsNo', q.rsNo, q, table.columnsForType, table.columns, section);
    fail(res, 'not_found', 'number_not_found', `${NOT_FOUND}: Survey No. ${q.rsNo} is not listed for village ${entries[0].village}.`);
    for (const h of unitsListing(rows, q.rsNo, 'base').slice(0, 5)) {
      res.suggestions.push(suggest('similar_number', `Survey No. ${h.token.s} is listed, not ${q.rsNo}.`, h));
    }
  } else {
    fail(res, 'not_found', 'survey_number_required', `${NOT_FOUND}: the village table lists survey numbers. Give the Survey (RS) No. to verify a rate.`);
  }

  if (q.blNo) {
    res.searches.push(`${FIELD_LABEL.blNo} ${q.blNo}`);
    for (const h of unitsListing(rows, q.blNo, 'exact').slice(0, 3)) {
      res.suggestions.push(suggest('other_identifier', `The number ${h.token.s} (your Block No.) appears in the survey number list. It may be a different property.`, h));
    }
  }
  if (header) {
    const key = q.propertyType === 'commercial' ? 'commercial' : 'residential';
    const cell = header.gamtal[key];
    if (cell) {
      res.suggestions.push({
        type: 'village_baseline', requiresManualVerification: true,
        description: `Village baseline (Gamtal ${RURAL_COLUMNS[key]}) rate is ${cell.v}. It is a village-level figure, not this property's rate.`,
        matchedText: null, zone: null, page: header.page, rate: cell.v, rateCategory: `Gamtal ${RURAL_COLUMNS[key]}`,
      });
    }
  }
  const first = res.suggestions.find((s) => s.matchedText && s.page);
  if (first) {
    const h = rows.flatMap((r) => r.tokens.filter((t) => t.s === first.matchedText && t.page === first.page).map((token) => ({ unit: r, token })))[0];
    if (h) res.evidence = evidenceFor(h.unit, h.token, null, section, `Suggestion only, not verified - ${first.matchedText}`, 'suggestion').slice(0, 1);
  } else if (header && res.suggestions.some((s) => s.type === 'village_baseline')) {
    res.evidence = [{ page: header.page, role: 'suggestion', expect: null, caption: `Suggestion only, not verified - ${entries[0].village} village baseline`,
      rects: [rect('block', 18, pageWidth - 36, header.top + 16, header.bottom - 8)] }];
  }
  return res;
}

async function lookup(doc, file, q, pdfName, onProgress) {
  // Corporation and Nagarpalika PDFs use the same table, so both go through Flow A
  if (RURAL_TABLES[q.pdfType]) return lookupRural(doc, file, q, pdfName, onProgress);
  return lookupUrban(doc, file, q, pdfName, onProgress);
}

module.exports = { lookup, baseResult, similarNames, PROPERTY_TYPES, RATE_UNIT, NOT_FOUND, nameKey };
