// Turns a raw property address into the fields the lookup needs.
// Example: "Moje Kosad, RS No. 582-1, BL No. 1072 Paiki 1, TPS No. 66 (Kosad-Variyav),
//           FP No. 327, ... Flat No. 1404, Tal. Surat City (Adajan), Dist. Surat"

const NUM = '(\\d+[A-Za-z0-9\\/\\-]*)';
const SEP = '\\s*(?:No\\.?|Number)?\\s*[:\\-]?\\s*';

function grab(re, s) {
  const m = s.match(re);
  return m ? m[1].trim() : null;
}

function detectPropertyType(s) {
  // "Final Plot" is the FP number, not a plot of land
  const t = s.replace(/final\s+plot/gi, ' ');
  if (/\bflat\b|\bapartment\b/i.test(t)) return 'flat';
  if (/\bshop\b|\bshowroom\b/i.test(t)) return 'shop';
  if (/\boffice\b/i.test(t)) return 'office';
  if (/\bindustrial\b|\bshed\b|\bfactory\b|\bGIDC\b/i.test(t)) return 'industrial';
  if (/\bcommercial\b/i.test(t)) return 'commercial';
  if (/\bplot\b|\bopen\s+land\b|\bbungalow\b|\brow\s*house\b|\bvilla\b|\bhouse\b|\bresiden/i.test(t)) return 'residential';
  return null;
}

// Only when the address says so. Otherwise it is left empty and the PDF that lists the village is used.
function detectPdfType(s) {
  if (/nagar\s*palika|municipality/i.test(s)) return 'NAGARPALIKA';
  if (/corporation|mahanagar/i.test(s)) return 'CORPORATION';
  return '';
}

function parseAddress(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();

  const fields = {
    district: grab(/\b(?:District|Dist\.|Dist(?=\s)|Di\.)\s*[:\-]?\s*([A-Za-z][A-Za-z ]*?)(?=\s*[,.;]|$)/i, s),
    taluka: grab(/\b(?:Taluka|Tal\.|Tal(?=\s)|Ta\.)\s*[:\-]?\s*([A-Za-z][A-Za-z ]*?(?:\s*\([^)]*\))?)(?=\s*[,.;]|$)/i, s),
    village: grab(/\b(?:Moje|Mouje|Mauje|Village|Gam)\.?\s*[:\-]?\s*([A-Za-z][A-Za-z ]*?)(?=\s*[,.;(]|$)/i, s),
    tps: grab(new RegExp(`\\bT\\.?\\s*P\\.?\\s*(?:S\\.?|Scheme)?${SEP}(\\d+)`, 'i'), s),
    fp: grab(new RegExp(`\\b(?:F\\.?\\s*P\\.?|Final\\s+Plot)${SEP}${NUM}`, 'i'), s),
    rsNo: grab(new RegExp(`\\b(?:R\\.?\\s*S\\.?|C\\.?\\s*T?\\.?\\s*S\\.?|Revenue\\s+Survey|City\\s+Survey|Survey)${SEP}${NUM}`, 'i'), s),
    blNo: grab(new RegExp(`\\b(?:B\\.?\\s*L\\.?|Block)${SEP}${NUM}`, 'i'), s),
  };
  fields.propertyType = detectPropertyType(s);
  fields.pdfType = detectPdfType(s);
  return fields;
}

module.exports = { parseAddress };
