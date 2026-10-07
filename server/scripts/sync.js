// npm run sync
// Reads the blog, downloads every PDF except Rural Agri, works out what each PDF really is from its
// content, builds the page indexes and parses every page as a check.
// Writes server/catalog.json (used by the bot to pick the right PDF) and data/check-report.json.
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { getBrowser } = require('../src/bot');
const { readBlogLinks, saveLinks, loadLinks, downloadPdf, fileNameOf } = require('../src/pdfSource');
const { openPdf, detectKind, getIndex, parseCorpSection, parseNaSection } = require('../src/pdfIndex');
const { CATALOG_FILE } = require('../src/catalog');

const REPORT_FILE = path.join(config.DATA_DIR, 'check-report.json');
// one result file per PDF, so an interrupted run continues where it stopped (--force starts over)
const DONE_DIR = path.join(config.DATA_DIR, 'sync');
const FORCE = process.argv.includes('--force');
fs.mkdirSync(DONE_DIR, { recursive: true });
const isNumber = (s) => /^(-\/)?\d/.test(s);

async function blogLinks() {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto(config.BLOG_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const links = await readBlogLinks(page);
    await browser.close();
    if (links.length) {
      saveLinks(links);
      return links;
    }
  } catch (err) {
    console.log(`Blog not reachable (${err.message.split('\n')[0]}) - using the saved link list`);
  }
  return loadLinks();
}

const mostCommon = (list) => {
  const count = {};
  for (const v of list) if (v) count[v] = (count[v] || 0) + 1;
  return Object.keys(count).sort((a, b) => count[b] - count[a]);
};

// consecutive pages of the same section, so blocks that continue on the next page stay together
function sections(index) {
  const out = [];
  for (const e of index) {
    const last = out[out.length - 1];
    if (last && last.name === e.name && last.taluka === e.taluka) last.pages.push(e.p);
    else out.push({ name: e.name, taluka: e.taluka, pages: [e.p] });
  }
  return out;
}

function sample(store, text) {
  store[text] = (store[text] || 0) + 1;
}

async function checkPdf(doc, kind, index) {
  const stats = { sections: 0, units: 0, noValues: 0, noNumbers: 0, pagesWithoutName: index.filter((e) => !e.name).length };
  const odd = {};
  const labels = {};
  for (const sec of sections(index)) {
    if (!sec.name) continue;
    stats.sections++;
    let units;
    if (kind === 'RURAL_NA') {
      const parsed = await parseNaSection(doc, sec.pages);
      units = parsed.rows;
      if (!parsed.header) stats.noGamtal = (stats.noGamtal || 0) + 1;
    } else {
      units = (await parseCorpSection(doc, sec.pages)).blocks;
      for (const b of units) {
        sample(labels, b.label.replace(/\d+/g, '#') || '(none)');
        if (!b.zone) stats.noZone = (stats.noZone || 0) + 1;
      }
    }
    for (const u of units) {
      stats.units++;
      if (!Object.keys(u.values).length) stats.noValues++;
      if (!u.tokens.some((t) => isNumber(t.s))) stats.noNumbers++;
      for (const t of u.tokens) if (!isNumber(t.s)) sample(odd, t.s.slice(0, 40));
    }
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
  return { ...stats, labels: top(labels, 12), oddTokens: top(odd, 15), oddTokenCount: Object.values(odd).reduce((a, b) => a + b, 0) };
}

(async () => {
  const seen = new Set();
  const links = (await blogLinks()).filter((l) => !/agri/i.test(fileNameOf(l.href)) && !seen.has(l.href) && seen.add(l.href));
  console.log(`${links.length} PDFs to check`);
  const files = [];
  const report = [];

  for (const link of links) {
    const name = fileNameOf(link.href);
    const doneFile = path.join(DONE_DIR, `${name}.json`);
    if (!FORCE && fs.existsSync(doneFile)) {
      const done = JSON.parse(fs.readFileSync(doneFile, 'utf8'));
      files.push(done.entry);
      report.push(done.check);
      continue;
    }
    const entry = { file: name, href: link.href, row: link.row || '', kind: null, district: '', talukas: [], pages: 0, names: [] };
    try {
      const pdf = await downloadPdf(link.href);
      const doc = await openPdf(pdf.file);
      entry.pages = doc.numPages;
      entry.kind = await detectKind(doc);
      if (entry.kind) {
        const index = await getIndex(doc, pdf.file, entry.kind);
        entry.district = mostCommon(index.map((e) => e.district))[0] || '';
        entry.talukas = mostCommon(index.map((e) => e.taluka));
        entry.names = [...new Set(index.map((e) => e.name).filter(Boolean))];
        const check = await checkPdf(doc, entry.kind, index);
        report.push({ file: name, kind: entry.kind, district: entry.district, pages: entry.pages, ...check });
        console.log(`${name.padEnd(34)} ${entry.kind.padEnd(12)} ${entry.district.padEnd(14)} pages=${entry.pages} sections=${check.sections} units=${check.units} noValues=${check.noValues} noNumbers=${check.noNumbers} noName=${check.pagesWithoutName} odd=${check.oddTokenCount}`);
      } else {
        report.push({ file: name, kind: null, pages: entry.pages, problem: 'text is not readable (font has no character map)' });
        console.log(`${name.padEnd(34)} UNREADABLE   row=${entry.row} pages=${entry.pages}`);
      }
      await doc.destroy();
    } catch (err) {
      report.push({ file: name, problem: err.message });
      console.log(`${name.padEnd(34)} FAILED ${err.message}`);
    }
    files.push(entry);
    fs.writeFileSync(doneFile, JSON.stringify({ entry, check: report[report.length - 1] }));
  }

  fs.writeFileSync(CATALOG_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), files }));
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 1));
  console.log(`\nCatalog: ${CATALOG_FILE}\nReport:  ${REPORT_FILE}`);
  process.exit(0);
})();
