// npm run selftest
// Round-trip check for every PDF in the catalog: take real numbers from real rows, look them up the
// same way the bot does (district + village + number) and check the strict rules hold:
//   ok        = "verified" with exactly the rate printed in that row (or "rate_not_available" for a blank cell)
//   ambiguous = the number is listed more than once, so the bot correctly refuses to pick one
//   fail      = anything else, above all a verified rate that differs from the row
// Run `npm run sync` first.
const path = require('path');
const config = require('../src/config');
const { loadCatalog, resolvePdf } = require('../src/catalog');
const { openPdf, getIndex, parseCorpSection, parseNaSection, parseAgriSection } = require('../src/pdfIndex');
const { lookup } = require('../src/lookup');
const { splitSectionName } = require('../src/names');

const SAMPLES_PER_PDF = Number(process.argv[2]) || 30;
const isNumber = (s) => /^(-\/)?\d/.test(s);

function sections(index) {
  const out = [];
  for (const e of index) {
    const last = out[out.length - 1];
    if (last && last.name === e.name && last.taluka === e.taluka) last.pages.push(e.p);
    else if (e.name) out.push({ name: e.name, taluka: e.taluka, district: e.district, pages: [e.p] });
  }
  return out;
}

(async () => {
  let total = 0;
  let passed = 0;
  let unclear = 0;
  const failures = [];
  // ONLY=amc.pdf npm run selftest  checks a single PDF
  for (const entry of loadCatalog().filter((f) => f.kind && (!process.env.ONLY || f.file === process.env.ONLY))) {
    const file = path.join(config.PDF_DIR, entry.file);
    const doc = await openPdf(file);
    const secs = sections(await getIndex(doc, file, entry.kind));
    const step = Math.max(1, Math.floor(secs.length / SAMPLES_PER_PDF));
    const tally = { ok: 0, ambiguous: 0, fail: 0 };

    for (let i = 0; i < secs.length && tally.ok + tally.ambiguous + tally.fail < SAMPLES_PER_PDF; i += step) {
      const sec = secs[i];
      const agri = entry.kind === 'RURAL_AGRI';
      const rural = agri || entry.kind === 'RURAL_NA';
      const units = agri ? (await parseAgriSection(doc, sec.pages)).rows : rural ? (await parseNaSection(doc, sec.pages)).rows : (await parseCorpSection(doc, sec.pages)).blocks;
      // rows with at least one plain number (a printed run such as 356TO365 is not sampled)
      const usable = units.filter((u) => u.tokens.some((t) => isNumber(t.s) && !t.range));
      if (!usable.length) continue;
      const unit = usable[Math.floor(usable.length / 2)];
      const numbers = unit.tokens.filter((t) => isNumber(t.s) && !t.range);
      const token = numbers[Math.floor(numbers.length / 2)].s;
      const split = splitSectionName(sec.name);
      const m = !rural && split.simple ? [sec.name, split.village, split.tps] : null; // other names are asked whole
      const q = {
        district: entry.district, taluka: sec.taluka, village: m && !rural ? m[1] : sec.name,
        tps: m && !rural ? m[2] : null, propertyType: agri ? 'agri_non_irrigated' : 'residential', pdfType: entry.kind,
      };
      // ask with the kind of number the list holds, as a user would (block lists hold block numbers)
      if (/block/i.test(unit.label || '')) q.blNo = token;
      else if (/survey|S\.?\s*NO/i.test(unit.label || '')) q.rsNo = token;
      else if (q.tps || /F\.?\s*P|final/i.test(unit.label || '')) q.fp = token;
      else q.rsNo = token;
      const expected = (agri ? unit.values.non_irrigated : rural ? unit.values.residential : unit.values[2]) || null;

      total++;
      let outcome;
      let got = null;
      try {
        const chosen = resolvePdf({ ...q });
        if (!chosen.file || chosen.file.file !== entry.file) throw new Error(chosen.failure ? chosen.failure.reason : `picked ${chosen.file.file}`);
        const res = await lookup(doc, file, q, entry.file, () => {});
        got = `${res.status}${res.rate === null ? '' : ` ${res.rate}`}`;
        if (res.status === 'ambiguous') outcome = 'ambiguous';
        else if (expected) outcome = res.status === 'verified' && res.rate === expected.v ? 'ok' : 'fail';
        else outcome = res.status === 'rate_not_available' ? 'ok' : 'fail';
      } catch (err) {
        outcome = 'fail';
        got = err.message;
      }
      tally[outcome]++;
      if (outcome === 'ok') passed++;
      if (outcome === 'ambiguous') unclear++;
      if (outcome === 'fail') failures.push(`${entry.file} | ${sec.name} | ${q.tps ? `TPS ${q.tps} FP` : 'No.'} ${token} | expected ${expected ? expected.v : 'empty'} got ${got}`);
    }
    await doc.destroy();
    console.log(`${entry.file.padEnd(34)} ${entry.kind.padEnd(12)} ${entry.district.padEnd(14)} ok=${tally.ok} ambiguous=${tally.ambiguous} fail=${tally.fail}`);
  }
  console.log(`\n${passed} of ${total} lookups were verified with exactly the printed rate; ${unclear} were refused as ambiguous (number listed more than once); ${failures.length} failed.`);
  for (const f of failures.slice(0, 60)) console.log('  FAIL', f);
  process.exit(0);
})();
