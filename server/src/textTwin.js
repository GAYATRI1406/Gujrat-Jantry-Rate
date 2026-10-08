// Some Jantri PDFs (Ahmedabad Municipal Corporation) were printed to PDF in a way that lost the
// character names of their fonts: a glyph is called "g36" (or ";###...") instead of "A", so programs
// read the text as meaningless codes although the page looks fine.
//
// The number in the name is the glyph's position in a standard Windows font, where position n is
// the character with code n + 29 (g36 -> A, g19 -> 0, 3 -> space). This was checked against the
// fonts in the same PDF that do carry proper names.
//
// makeTextTwin writes a copy of the PDF with the names put back. The copy is used only for reading
// text; the original is still the one shown and photographed.
const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFName, PDFDict, PDFArray } = require('pdf-lib');
const { PDF_DIR } = require('./config');

const TWIN_DIR = path.join(PDF_DIR, '_text');

const PUNCTUATION = {
  32: 'space', 33: 'exclam', 34: 'quotedbl', 35: 'numbersign', 36: 'dollar', 37: 'percent', 38: 'ampersand', 39: 'quotesingle',
  40: 'parenleft', 41: 'parenright', 42: 'asterisk', 43: 'plus', 44: 'comma', 45: 'hyphen', 46: 'period', 47: 'slash',
  48: 'zero', 49: 'one', 50: 'two', 51: 'three', 52: 'four', 53: 'five', 54: 'six', 55: 'seven', 56: 'eight', 57: 'nine',
  58: 'colon', 59: 'semicolon', 60: 'less', 61: 'equal', 62: 'greater', 63: 'question', 64: 'at',
  91: 'bracketleft', 92: 'backslash', 93: 'bracketright', 94: 'asciicircum', 95: 'underscore', 96: 'grave',
  123: 'braceleft', 124: 'bar', 125: 'braceright', 126: 'asciitilde',
};

// Standard glyph name of a character code ("A", "zero", "comma", ...).
function glyphName(code) {
  if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return String.fromCharCode(code);
  return PUNCTUATION[code] || `uni${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

// Position in the font, from a lost name: "g36" -> 36, ";###" -> 3. null for a normal name.
function glyphPosition(name) {
  const g = /^g(\d+)$/.exec(name);
  if (g) return Number(g[1]);
  const hashes = /^;(#+)$/.exec(name);
  return hashes ? hashes[1].length : null;
}

const twinPath = (file) => path.join(TWIN_DIR, path.basename(file));

// The file to read text from: the corrected copy when one exists, else the PDF itself.
const textFile = (file) => (fs.existsSync(twinPath(file)) ? twinPath(file) : file);

// Writes the corrected copy if the PDF has lost glyph names. Returns the number of names repaired (0 = not needed).
async function makeTextTwin(file) {
  const doc = await PDFDocument.load(fs.readFileSync(file), { updateMetadata: false });
  let repaired = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const differences = doc.context.lookup(obj.get(PDFName.of('Differences')));
    if (!(differences instanceof PDFArray)) continue;
    for (let i = 0; i < differences.size(); i++) {
      const entry = differences.get(i);
      if (!(entry instanceof PDFName)) continue;
      const position = glyphPosition(entry.decodeText());
      if (position === null) continue;
      differences.set(i, PDFName.of(glyphName(position + 29)));
      repaired++;
    }
  }
  if (!repaired) return 0;
  fs.mkdirSync(TWIN_DIR, { recursive: true });
  fs.writeFileSync(twinPath(file), await doc.save());
  return repaired;
}

module.exports = { makeTextTwin, textFile, twinPath, TWIN_DIR };
