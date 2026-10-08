// How section names printed in the PDFs are compared and split into village + TP scheme.

// Same name regardless of case, spaces and punctuation; text in brackets is ignored.
const nameKey = (s) => String(s || '').toUpperCase().replace(/\(.*?\)/g, '').replace(/[^A-Z0-9]/g, '');

// "KOSAD TPS-66"                               -> { village: 'KOSAD', tps: '66' }
// "NAVA VADAJ- FINAL T.P.S NO - 28"            -> { village: 'NAVA VADAJ', tps: '28' }   (Ahmedabad style)
// "AMBLI - DRAFT SUBMITTED T.P.S. NO.-212"     -> { village: 'AMBLI', tps: '212' }
// "AMBLI - DASKROI"                            -> { village: 'AMBLI - DASKROI', tps: null }
// simple = the short "VILLAGE TPS-nn" form, where village + TPS number identify the section on their own
function splitSectionName(name) {
  const s = String(name || '').trim();
  const short = s.match(/^(.*?)\s*TPS\s*-?\s*0*(\d+)\s*$/i);
  if (short) return { village: short[1].trim(), tps: short[2], tpScheme: true, simple: true };
  const long = s.match(/^(.*?)[\s,-]*(?:(?:FINAL|PRELIMINARY|DRAFT(?:\s+(?:SUBMITTED|SANCTIONED))?)[\s-]*)?T\.\s*P\.\s*S\b\.?\s*(?:NO\b\.?)?[\s.-]*0*(\d+)?/i);
  if (long && long[1].trim()) return { village: long[1].trim(), tps: long[2] || null, tpScheme: true, simple: false };
  return { village: s, tps: null, tpScheme: /T\.\s*P\.\s*S/i.test(s), simple: false };
}

module.exports = { nameKey, splitSectionName };
