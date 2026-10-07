// Reads the Jantri PDFs as positioned text and turns pages into searchable blocks/rows.
//
// Corporation PDF page:   header (district / taluka / "VILLAGE TPS-nn"), then repeated blocks of
//                         [zone id + rate values] [label e.g. "FP. No TPS-66"] [number list]
// Rural NA PDF page:      header (district / taluka / village / Gamtal rates), then rows of
//                         [survey number list ending in "."] [residential] [commercial] [industrial]
const fs = require('fs');
const path = require('path');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const { INDEX_DIR } = require('./config');

const DIGITS = /^\d+$/;
const LINE_TOLERANCE = 4;

// x position (PDF points) where each rate column starts
const CORP_COLUMNS = [
  { col: 2, x: 166 }, { col: 3, x: 232 }, { col: 4, x: 296 }, { col: 5, x: 354 },
  { col: 6, x: 418 }, { col: 7, x: 482 }, { col: 8, x: 534 },
];
const LIST_LABEL = /^(FP|F\.P|Survey|Block|TPS|T\.P|City|C\.?S|R\.?S|Ward|Tika|Sheet|Nondh|Plot(?!s)|Final|Chalta)/i;
const LIST_FILLER = /plots|boundary|zone|included|^and\b|^all\b|^other\b|^in\b|^the\b/i;

async function openPdf(file) {
  const data = new Uint8Array(await fs.promises.readFile(file));
  return pdfjs.getDocument({ data, verbosity: 0, disableFontFace: true }).promise;
}

// Text of one page grouped into lines (top to bottom), items left to right.
// Bold labels are drawn several times on top of each other; those are collapsed and flagged `label`.
async function pageLines(doc, pageNo) {
  const page = await doc.getPage(pageNo);
  const [, , width, height] = page.view;
  const content = await page.getTextContent();
  const items = content.items
    .filter((i) => i.str && i.str.trim())
    .map((i) => ({ x: i.transform[4], y: i.transform[5], w: i.width, raw: i.str, s: i.str.trim() }))
    .sort((a, b) => b.y - a.y);

  const lines = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    if (last && last.y - it.y <= LINE_TOLERANCE) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    const kept = [];
    for (const it of line.items) {
      const dup = kept.find((k) => k.s === it.s && Math.abs(k.x - it.x) <= 2.5);
      if (dup) dup.label = true;
      else kept.push(it);
    }
    line.items = kept;
    line.top = Math.max(...kept.map((k) => k.y));
    line.bottom = Math.min(...kept.map((k) => k.y));
  }
  page.cleanup();
  return { lines, width, height };
}

const values = (line) => line.items.filter((t) => !t.label && t.s !== ':');
const joined = (items) => items.map((t) => t.s).join(' ').trim();

function corpHeader(lines) {
  const h = { district: '', taluka: '', name: '', bodyStart: 0 };
  let nameIdx = -1;
  let distFound = false;
  for (let i = 0; i < Math.min(lines.length, 12); i++) {
    const colons = lines[i].items.filter((t) => t.s === ':');
    if (!distFound && colons.length >= 2) {
      const split = colons[1].x;
      h.district = joined(values(lines[i]).filter((t) => t.x < split));
      h.taluka = joined(values(lines[i]).filter((t) => t.x > split));
      distFound = true;
    } else if (distFound && colons.length === 1) {
      h.name = joined(values(lines[i]).filter((t) => t.x > colons[0].x));
      nameIdx = i;
      break;
    }
  }
  if (nameIdx < 0) return h;
  // the header ends with the row of column numbers (single glyphs)
  for (let i = nameIdx + 1; i < Math.min(lines.length, nameIdx + 14); i++) {
    const it = lines[i].items;
    if (it.length >= 4 && it.every((t) => t.s.length <= 2)) {
      h.bodyStart = i + 1;
      h.head = { top: lines[nameIdx + 1].top + 16, bottom: lines[i].bottom - 8 };
      return h;
    }
  }
  h.bodyStart = nameIdx + 1;
  return h;
}

function naHeader(lines) {
  const h = { district: '', taluka: '', name: '', bodyStart: 0, gamtal: null, headerTop: null, headerBottom: null };
  const isUnit = (t) => /Rs\.?\s*per\s*Sq/i.test(t.s);
  const vi = lines.findIndex((l) => l.items.some(isUnit));
  if (vi < 0) return h;
  const nameOf = (line) => joined(values(line).filter((t) => !isUnit(t) && t.x < 500));
  h.name = nameOf(lines[vi]);
  // in some PDFs the village name is printed a little lower and lands on the next line
  if (!h.name && lines[vi + 1] && lines[vi].bottom - lines[vi + 1].top < 8) h.name = nameOf(lines[vi + 1]);
  if (vi > 0) {
    h.district = joined(values(lines[vi - 1]).filter((t) => t.x < 200));
    h.taluka = joined(values(lines[vi - 1]).filter((t) => t.x >= 200));
  }
  let gi = -1;
  for (let i = vi + 1; i <= Math.min(vi + 3, lines.length - 1); i++) {
    const nums = lines[i].items.filter((t) => DIGITS.test(t.s));
    if (nums.length) {
      h.gamtal = {};
      for (const n of nums.filter((t) => Number(t.s) > 0)) h.gamtal[n.x < 300 ? 'residential' : 'commercial'] = { v: Number(n.s), x: n.x, y: n.y, w: n.w };
      gi = i;
      break;
    }
  }
  if (gi < 0) gi = vi;
  h.headerTop = lines[vi].top;
  h.headerBottom = lines[gi].bottom;
  // skip the column-title lines; data rows start at the left margin
  let i = gi + 1;
  for (let skipped = 0; i < lines.length && skipped < 4 && lines[i].items[0].x >= 60; skipped++) i++;
  h.bodyStart = i;
  if (i > gi + 1) h.head = { top: lines[gi + 1].top + 14, bottom: lines[i - 1].bottom - 8 };
  return h;
}

// What a PDF really is, read from its first page (file names on the website are not reliable).
// CORPORATION and NAGARPALIKA share one table layout; RURAL_NA has its own.
async function detectKind(doc) {
  const { lines } = await pageLines(doc, 1);
  const text = lines.slice(0, 12).flatMap((l) => l.items.map((t) => t.s));
  if (text.some((s) => /Rs\.?\s*per\s*Sq/i.test(s))) return 'RURAL_NA';
  if (text.some((s) => /CORPORATION/.test(s))) return 'CORPORATION';
  if (text.some((s) => /NAGARPALIKA/.test(s))) return 'NAGARPALIKA';
  return null;
}

// One entry per page: which district / taluka / section the page belongs to. Cached on disk.
async function getIndex(doc, file, kind, onProgress) {
  const cacheFile = path.join(INDEX_DIR, `${path.basename(file)}.${kind}.json`);
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const { lines } = await pageLines(doc, p);
    const h = kind === 'RURAL_NA' ? naHeader(lines) : corpHeader(lines);
    pages.push({ p, district: h.district, taluka: h.taluka, name: h.name });
    if (onProgress && (p % 40 === 0 || p === doc.numPages)) onProgress(p, doc.numPages);
  }
  fs.writeFileSync(cacheFile, JSON.stringify(pages));
  return pages;
}

function extend(unit, page, line) {
  let part = unit.parts.find((pt) => pt.page === page);
  if (!part) unit.parts.push((part = { page, top: -Infinity, bottom: Infinity }));
  part.top = Math.max(part.top, line.top);
  part.bottom = Math.min(part.bottom, line.bottom);
}

// Digits and letters are about twice as wide as commas, dots and spaces in these PDFs.
const glyphWidth = (s) => [...s].reduce((sum, ch) => sum + (/[\s,.:;]/.test(ch) ? 0.5 : 1), 0);

// Splits the text items of a number list into individual numbers with their position.
function addTokens(unit, items, page) {
  for (const it of items) {
    const re = /[^,]+/g;
    let m;
    while ((m = re.exec(it.raw))) {
      const text = m[0].trim().replace(/\.$/, '');
      if (!text || LIST_FILLER.test(text)) continue;
      const start = m.index + m[0].indexOf(m[0].trim());
      const scale = it.w / glyphWidth(it.raw);
      unit.tokens.push({
        s: text, page, y: it.y,
        x: it.x + glyphWidth(it.raw.slice(0, start)) * scale,
        w: Math.max(glyphWidth(text) * scale, 6),
      });
    }
  }
}

async function parseCorpSection(doc, pageNos) {
  const blocks = [];
  const heads = {}; // column-title strip of each page
  let cur = null;
  let pageWidth = 612;
  for (const p of pageNos) {
    const { lines, width } = await pageLines(doc, p);
    pageWidth = width;
    const { bodyStart, head } = corpHeader(lines);
    heads[p] = head;
    for (const line of lines.slice(bodyStart)) {
      const [first, ...rest] = line.items;
      const allRates = line.items.every((t) => t.x >= 150 && DIGITS.test(t.s));
      const zoneLine = first.x < 150 && !/[,\s]/.test(first.s) && rest.length > 0
        && rest.every((t) => t.x >= 150 && DIGITS.test(t.s));
      if (zoneLine || allRates) {
        cur = { zone: zoneLine ? first.s : '', label: '', values: {}, tokens: [], parts: [] };
        blocks.push(cur);
        for (const t of (zoneLine ? rest : line.items).filter((v) => Number(v.s) > 0)) {
          const column = CORP_COLUMNS.reduce((a, b) => (Math.abs(b.x - t.x) < Math.abs(a.x - t.x) ? b : a));
          cur.values[column.col] = { v: Number(t.s), page: p, x: t.x, y: t.y, w: t.w };
        }
      } else {
        if (!cur) blocks.push((cur = { zone: '', label: '', values: {}, tokens: [], parts: [] }));
        if (LIST_LABEL.test(first.s) && !first.s.includes(',')) cur.label = joined(line.items);
        else addTokens(cur, line.items, p);
      }
      extend(cur, p, line);
    }
  }
  return { blocks, heads, pageWidth };
}

async function parseNaSection(doc, pageNos) {
  const rows = [];
  const heads = {};
  let cur = null;
  let header = null;
  let pageWidth = 595;
  for (const p of pageNos) {
    const { lines, width } = await pageLines(doc, p);
    pageWidth = width;
    const h = naHeader(lines);
    heads[p] = h.head;
    if (!header && h.gamtal) header = { page: p, gamtal: h.gamtal, top: h.headerTop, bottom: h.headerBottom };
    let last = cur;
    for (const line of lines.slice(h.bodyStart)) {
      if (line.items[0].s.startsWith('*')) break; // footnotes
      const left = line.items.filter((t) => t.x < 250);
      const rates = line.items.filter((t) => t.x >= 250 && t.x < 500 && DIGITS.test(t.s));
      if (left.length) {
        if (!cur) rows.push((cur = { values: {}, tokens: [], parts: [] }));
        addTokens(cur, left, p);
        last = cur;
      }
      if (!last) continue;
      if (last === cur) {
        for (const t of rates.filter((v) => Number(v.s) > 0)) {
          const key = t.x < 303 ? 'residential' : t.x < 375 ? 'commercial' : 'industrial';
          last.values[key] = { v: Number(t.s), page: p, x: t.x, y: t.y, w: t.w };
        }
      }
      extend(last, p, line); // remark lines to the right belong to the row above them
      if (left.length && /\.\s*$/.test(left[left.length - 1].s)) cur = null; // a list ends with "."
    }
  }
  return { rows, heads, header, pageWidth };
}

module.exports = { openPdf, detectKind, getIndex, parseCorpSection, parseNaSection };
