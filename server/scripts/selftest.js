// npm run selftest
// Round-trip check for every PDF in the catalog: take real numbers from real rows, look them up the
// same way the bot does (district + village + number), and confirm the rate that comes back is the
// one printed in that row. Run `npm run sync` first.
const path = require('path');
const config = require('../src/config');
const { loadCatalog, choosePdf } = require('../src/catalog');
const { openPdf, getIndex, parseCorpSection, parseNaSection } = require('../src/pdfIndex');
const { lookup } = require('../src/lookup');

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
  for (const entry of loadCatalog().filter((f) => f.kind)) {
    const file = path.join(config.PDF_DIR, entry.file);
    const doc = await openPdf(file);
    const secs = sections(await getIndex(doc, file, entry.kind));
    const step = Math.max(1, Math.floor(secs.length / SAMPLES_PER_PDF));
    const tally = { ok: 0, unclear: 0, fail: 0 };

    for (let i = 0; i < secs.length && tally.ok + tally.unclear + tally.fail < SAMPLES_PER_PDF; i += step) {
      const sec = secs[i];
      const rural = entry.kind === 'RURAL_NA';
      const units = rural ? (await parseNaSection(doc, sec.pages)).rows : (await parseCorpSection(doc, sec.pages)).blocks;
      const usable = units.filter((u) => u.tokens.some((t) => isNumber(t.s)));
      if (!usable.length) continue;
      const unit = usable[Math.floor(usable.length / 2)];
      const numbers = unit.tokens.filter((t) => isNumber(t.s));
      const token = numbers[Math.floor(numbers.length / 2)].s;
      const m = sec.name.match(/^(.*?)\s*TPS\s*-?\s*0*(\d+)\s*$/i);
      const q = {
        district: entry.district, taluka: sec.taluka, village: m && !rural ? m[1] : sec.name,
        tps: m && !rural ? m[2] : null, propertyType: 'residential', pdfType: entry.kind,
      };
      if (q.tps) q.fp = token;
      else q.rsNo = token;
      const expected = (rural ? unit.values.residential : unit.values[2]) || null;

      total++;
      let outcome;
      let got = null;
      try {
        const chosen = choosePdf({ ...q });
        if (chosen.file.file !== entry.file) throw new Error(`picked ${chosen.file.file}`);
        const res = await lookup(doc, file, q, entry.file, () => {});
        got = res.rate;
        // compare the rate only: a block's rates can be printed on the page before its number list
        if (got === (expected ? expected.v : null)) outcome = 'ok';
        else if (res.needsReview || res.notes.some((n) => /searched|closest/.test(n))) outcome = 'unclear'; // number listed in several rows / sections
        else outcome = 'fail';
      } catch (err) {
        outcome = 'fail';
        got = err.message;
      }
      tally[outcome]++;
      if (outcome === 'ok') passed++;
      if (outcome === 'unclear') unclear++;
      if (outcome === 'fail') failures.push(`${entry.file} | ${sec.name} | ${q.tps ? `TPS ${q.tps} FP` : 'No.'} ${token} | expected ${expected ? expected.v : 'empty'} got ${got}`);
    }
    await doc.destroy();
    console.log(`${entry.file.padEnd(34)} ${entry.kind.padEnd(12)} ${entry.district.padEnd(14)} ok=${tally.ok} unclear=${tally.unclear} fail=${tally.fail}`);
  }
  console.log(`\n${passed} of ${total} lookups returned exactly the printed rate; ${unclear} hit a number listed more than once (flagged for review); ${failures.length} failed.`);
  for (const f of failures.slice(0, 60)) console.log('  FAIL', f);
  process.exit(0);
})();
