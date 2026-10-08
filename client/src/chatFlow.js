// Question-and-answer flow for the "Chat" option. The bot asks one thing at a time and searches when
// it has everything. Pure functions: state in, state out.
//   state = { step, f (the fields collected so far), districts, kinds (from /api/places), choices, note }
import { PROPERTY_TYPES, TYPES_BY_AREA } from './constants.js';

const AREA = {
  CORPORATION: 'City (Corporation)',
  NAGARPALIKA: 'Town (Nagarpalika)',
  RURAL_NA: 'Village (Rural NA)',
};
// words people use for an area unit -> the unit the server understands (plain number = sq. mt.)
const UNIT_WORDS = [[/ft|feet|foot/, 'sqft'], [/yd|yard|var|gaj/, 'sqyd'], [/gunt/, 'guntha'], [/acre/, 'acre'], [/hect|\bha\b/, 'hectare']];
const SKIP = /^(skip|no|none|nil|na|n\/a|-)$/i;

const key = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
const opt = (label, value = label) => ({ label, value });

const kindOf = (s) => s.kinds.find((k) => k.kind === s.f.pdfType);
const talukaOf = (s) => kindOf(s).talukas.find((t) => t.name === s.f.taluka);
const villageOf = (s) => talukaOf(s).villages.find((v) => v.name === s.f.village);
const rural = (s) => s.f.pdfType === 'RURAL_NA';

function optionsFor(s) {
  switch (s.step) {
    case 'district': return s.districts.map((d) => opt(d));
    case 'kind': return s.kinds.map((k) => opt(AREA[k.kind], k.kind));
    case 'taluka': return kindOf(s).talukas.map((t) => opt(t.name));
    case 'village': return talukaOf(s).villages.map((v) => opt(v.name));
    case 'tps': {
      const v = villageOf(s);
      return [...v.tps.map((t) => opt(`TPS-${t}`, t)), ...(v.plain ? [opt('No TPS', '')] : [])];
    }
    case 'bl': return [opt('Skip', '')];
    case 'type': return TYPES_BY_AREA[s.f.pdfType].map((value) => opt(PROPERTY_TYPES[value], value));
    case 'area': return [opt('Skip', '')];
    default: return [];
  }
}

const QUESTIONS = {
  district: () => 'Which district is the property in?',
  kind: () => 'Is it in a city, a town or a village?',
  taluka: () => 'Which taluka?',
  village: (s) => (rural(s) ? 'What is the village name?' : 'What is the village or ward name?'),
  tps: () => 'Which TPS number?',
  fp: () => 'What is the FP No. (Final Plot number)?',
  rs: (s) => (rural(s) ? 'What is the RS No. (survey number)?' : 'What is the Survey / City Survey No.?'),
  bl: () => 'What is the Block No.? Type "skip" if you do not have one.',
  type: () => 'What type of property is it?',
  area: () => 'What is the property area? Type a number for sq. mt., or add the unit, for example "1200 sqft". Type "skip" for the rate only.',
};

// The question to show for the current step, with the answers the user can pick from.
export function question(s) {
  return { text: QUESTIONS[s.step] ? QUESTIONS[s.step](s) : '', options: optionsFor(s) };
}

function match(text, options) {
  const want = key(text);
  if (!want) return [];
  const exact = options.filter((o) => key(o.label) === want || key(o.value) === want);
  if (exact.length) return exact;
  const starts = options.filter((o) => key(o.label).startsWith(want));
  return starts.length ? starts : options.filter((o) => key(o.label).includes(want));
}

// Moves on after a value is stored; steps with a single possible answer are filled in automatically.
function advance(s) {
  let state = { ...s, choices: null };
  const notes = [];
  for (;;) {
    const { step, f } = state;
    let next;
    if (step === 'district') next = 'places'; // the app loads the district's lists, then calls withPlaces
    else if (step === 'loaded') next = 'kind';
    else if (step === 'kind') next = 'taluka';
    else if (step === 'taluka') next = 'village';
    else if (step === 'village') next = rural(state) ? 'rs' : villageOf(state).tps.length ? 'tps' : villageOf(state).fpList ? 'fp' : 'rs';
    else if (step === 'tps') next = f.tps ? 'fp' : 'rs';
    else if (step === 'fp') next = 'type';
    else if (step === 'rs') next = rural(state) ? 'bl' : 'type';
    else if (step === 'bl') next = 'type';
    else if (step === 'type') next = 'area';
    else next = 'done';

    state = { ...state, step: next };
    const options = ['kind', 'taluka', 'village', 'tps'].includes(next) ? optionsFor(state) : [];
    if (options.length !== 1) break;
    // only one possibility: take it and say so
    const field = { kind: 'pdfType', taluka: 'taluka', village: 'village', tps: 'tps' }[next];
    state = { ...state, f: { ...state.f, [field]: options[0].value } };
    notes.push(`${options[0].label} is the only ${next === 'kind' ? 'area type' : next} here.`);
  }
  return { ...state, note: notes.join(' ') };
}

// Called once the district's talukas and villages are loaded.
export function withPlaces(s, kinds) {
  return advance({ ...s, kinds, step: 'loaded' });
}

// Takes the user's reply. Returns { state } to continue, or { state, error } to ask the same thing again.
export function answer(s, text, picked) {
  const value = text.trim();
  const fieldByStep = { district: 'district', kind: 'pdfType', taluka: 'taluka', village: 'village', tps: 'tps', type: 'propertyType' };

  if (fieldByStep[s.step]) {
    const options = optionsFor(s);
    const found = picked ? [picked] : match(value, options);
    if (found.length === 1) {
      const state = advance({ ...s, f: { ...s.f, [fieldByStep[s.step]]: found[0].value } });
      // matched from part of a name: say which one was taken
      const partial = !picked && key(found[0].label) !== key(value) && key(found[0].value) !== key(value);
      if (partial) state.note = [`I took that as ${found[0].label}.`, state.note].filter(Boolean).join(' ');
      return { state };
    }
    if (found.length > 1) {
      return { state: { ...s, choices: found.slice(0, 14) }, error: `I found ${found.length} matches for "${value}". Which one do you mean?` };
    }
    // nothing matched: offer names that start with the same letter
    const near = options.filter((o) => key(o.label)[0] === key(value)[0]).slice(0, 14);
    return { state: { ...s, choices: near.length ? near : null }, error: `I could not find "${value}" in the list. Please check the spelling${near.length ? ' or pick one below' : ''}.` };
  }

  if (s.step === 'area') {
    if (picked || SKIP.test(value)) return { state: advance({ ...s, f: { ...s.f, area: '', areaUnit: 'sqmt' } }) };
    const m = value.replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    if (!m || !(Number(m[1]) > 0)) return { state: s, error: 'Please type the area as a number, for example 100 or 1200 sqft, or type skip.' };
    const words = m[2].toLowerCase();
    if (/bigha|vigha/.test(words)) return { state: s, error: 'Bigha / vigha has no single fixed size. Please give the area in sq. mt., sq. ft., sq. yd., guntha, acre or hectare.' };
    const unit = (UNIT_WORDS.find(([re]) => re.test(words)) || [null, 'sqmt'])[1];
    return { state: advance({ ...s, f: { ...s.f, area: m[1], areaUnit: unit } }) };
  }

  if (s.step === 'bl') return { state: advance({ ...s, f: { ...s.f, blNo: SKIP.test(value) ? '' : value } }) };

  // FP No. / survey number
  const number = (value.match(/\d[\w/-]*/) || [])[0];
  if (!number) return { state: s, error: 'Please type the number, for example 327.' };
  return { state: advance({ ...s, f: { ...s.f, [s.step === 'fp' ? 'fp' : 'rsNo']: number } }) };
}

export const startState = (districts) => ({ step: 'district', f: {}, districts, kinds: [], choices: null, note: '' });
