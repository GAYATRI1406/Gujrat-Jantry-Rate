// npm run report      (the server must be running: npm start)
// Runs every case in testing/cases.json through POST /api/jantri/lookup and writes
// testing/jantri-test-report.csv, with the evidence screenshots copied to testing/screenshots/.
//
// The "official" columns are NOT produced by the bot. They come from testing/official.json, which a
// person fills in by reading the source page: { "<case id>": { "rate": 12750, "how": "...", "by": "..." } }
// A case is "Correct" when the bot's status is the expected one and, for a verified rate, the bot's
// rate equals the official rate that was read independently.
const fs = require('fs');
const path = require('path');
const config = require('../src/config');

const ROOT = path.join(__dirname, '..', '..', 'testing');
const SHOTS = path.join(ROOT, 'screenshots');
const API = `http://localhost:${config.PORT}/api/jantri/lookup`;

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const describeInput = (r) => [
  r.district && `District ${r.district}`,
  r.taluka && `Taluka ${r.taluka}`,
  r.village && `Village ${r.village}`,
  r.areaType && `Area type ${r.areaType}`,
  r.tpScheme && `TPS ${r.tpScheme}`,
  r.fpNumber && `FP ${r.fpNumber}`,
  r.surveyNumber && `Survey ${r.surveyNumber}`,
  r.blockNumber && `Block ${r.blockNumber}`,
  `Type ${[r.propertyType, r.propertySubType].filter(Boolean).join(' / ')}`,
  r.areaSqmt !== undefined ? `Area ${r.areaSqmt} sqmt` : r.area !== undefined ? `Area ${r.area} ${r.areaUnit}` : null,
].filter(Boolean).join('; ');

(async () => {
  const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'cases.json'), 'utf8'));
  const officialFile = path.join(ROOT, 'official.json');
  const official = fs.existsSync(officialFile) ? JSON.parse(fs.readFileSync(officialFile, 'utf8')) : {};
  fs.mkdirSync(SHOTS, { recursive: true });

  const header = ['Case', 'Category', 'Input details', 'Expected result', 'Bot status', 'Bot message',
    'Bot Jantri rate (Rs/sqmt)', 'Rate category', 'Area (sqmt)', 'Bot government value (Rs)', 'Calculation',
    'Suggestions shown (not verified)', 'Source document', 'Page', 'Zone', 'Source URL', 'Screenshot',
    'Official rate (Rs/sqmt)', 'How the official rate was checked', 'Checked by', 'Value check (area x official rate)', 'Correct?', 'Remarks'];
  const rows = [header];
  let correct = 0;

  for (const c of cases) {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c.request) });
    const r = await res.json();

    // keep the evidence next to the report
    let shot = '';
    if (r.screenshotUrl) {
      shot = `screenshots/case-${String(c.id).padStart(2, '0')}.png`;
      fs.copyFileSync(path.join(config.SHOTS_DIR, path.basename(r.screenshotUrl)), path.join(ROOT, shot));
      if (r.pageScreenshotUrl) fs.copyFileSync(path.join(config.SHOTS_DIR, path.basename(r.pageScreenshotUrl)), path.join(ROOT, shot.replace('.png', '-page.png')));
    }

    const off = official[c.id] || {};
    const statusOk = r.status === c.expect;
    let verdict;
    let remarks = off.remarks || '';
    if (!statusOk) verdict = 'No';
    else if (r.status !== 'verified') verdict = off.how ? 'Yes' : 'Not checked yet';
    else if (off.rate === undefined) verdict = 'Not checked yet';
    else verdict = Number(off.rate) === r.jantriRate ? 'Yes' : 'No';
    if (!statusOk) remarks = `Expected ${c.expect}, got ${r.status}. ${remarks}`.trim();
    if (verdict === 'Yes') correct++;

    // the value worked out here from the official rate, not taken from the bot
    let valueCheck = '';
    if (r.status === 'verified' && off.rate !== undefined && r.areaSqmt) {
      const mine = Math.round(r.areaSqmt * Number(off.rate));
      valueCheck = `${mine}${Math.abs(mine - r.governmentValue) <= 1 ? ' (matches)' : ' (DIFFERS)'}`;
    }

    const alternatives = [...(r.candidates || []), ...(r.suggestions || [])]
      .map((s) => `${s.description}${s.rate ? ` [${s.rate}]` : ''}`).join(' | ');
    rows.push([c.id, c.category, describeInput(c.request), c.expect, r.status, r.message,
      r.jantriRate, r.rateCategory, r.areaSqmt, r.governmentValue, r.calculation,
      alternatives, r.sourceDocument, r.pageNumber, r.matchedEntry ? r.matchedEntry.zone : '', r.sourceUrl, shot,
      off.rate === undefined ? (off.finding || '') : off.rate, off.how || '', off.by || '', valueCheck, verdict, remarks]);
    console.log(`${String(c.id).padStart(2)}. ${r.status.padEnd(18)} rate=${String(r.jantriRate ?? '-').padEnd(6)} official=${String(off.rate ?? off.finding ?? '?').padEnd(12)} ${verdict.padEnd(15)} ${c.category}`);
  }

  // UTF-8 with BOM so Excel shows the rupee sign and Gujarati text correctly
  fs.writeFileSync(path.join(ROOT, 'jantri-test-report.csv'), `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`);
  console.log(`\n${correct} of ${cases.length} cases correct. Report: ${path.join(ROOT, 'jantri-test-report.csv')}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
