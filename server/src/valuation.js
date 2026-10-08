// Government value = area (sq. mt.) x Jantri rate (Rs. per sq. mt.).
// Nothing else is applied: no extra charges, factors or rules are guessed.

// Units with one fixed conversion to square metres.
const SQMT_PER_UNIT = {
  sqmt: 1,
  sqft: 0.09290304,
  sqyd: 0.83612736,
  are: 100,
  guntha: 101.17141056, // 1/40 acre
  acre: 4046.8564224,
  hectare: 10000,
};

const UNIT_ALIASES = {
  sqmt: ['sqmt', 'sqm', 'sqmtr', 'sqmeter', 'sqmetre', 'squaremeter', 'squaremetre', 'm2', 'chomi'],
  sqft: ['sqft', 'sft', 'sqfeet', 'sqfoot', 'squarefeet', 'squarefoot', 'ft2'],
  sqyd: ['sqyd', 'sqyard', 'sqyards', 'squareyard', 'squareyards', 'var', 'vaar', 'gaj', 'yd2'],
  are: ['are', 'ares'],
  guntha: ['guntha', 'gunta', 'gunthas'],
  acre: ['acre', 'acres'],
  hectare: ['hectare', 'hectares', 'ha'],
};
// local units whose size changes from region to region - never converted by guesswork
const VARIABLE_UNITS = ['bigha', 'vigha', 'vingha', 'biga'];

const UNIT_LABEL = { sqmt: 'Sq. Mtr.', sqft: 'Sq. Ft.', sqyd: 'Sq. Yd.', are: 'Are', guntha: 'Guntha', acre: 'Acre', hectare: 'Hectare' };

const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const num = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 4 });

// Returns { unit } for a recognised unit, or { error } explaining why it cannot be used.
function normalizeUnit(raw) {
  const key = String(raw || 'sqmt').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (VARIABLE_UNITS.includes(key)) {
    return { error: `"${raw}" has no single fixed size in Gujarat. Give the area in sq. mt., sq. ft., sq. yd., guntha, acre or hectare.` };
  }
  const unit = Object.keys(UNIT_ALIASES).find((u) => UNIT_ALIASES[u].includes(key));
  return unit ? { unit } : { error: `Area unit "${raw}" is not supported. Use: ${Object.keys(SQMT_PER_UNIT).join(', ')}.` };
}

// area: a positive number in `unit`. Returns the area in sq. mt. (not rounded) with how it was converted.
function toSqmt(area, unit) {
  const areaSqmt = area * SQMT_PER_UNIT[unit];
  return {
    areaSqmt,
    conversion: unit === 'sqmt' ? null : `${num(area)} ${UNIT_LABEL[unit]} × ${SQMT_PER_UNIT[unit]} = ${num(areaSqmt)} Sq. Mtr.`,
  };
}

// rate is Rs. per sq. mt. The value is rounded to the nearest rupee only at the end.
function governmentValue(areaSqmt, rate) {
  const value = Math.round(areaSqmt * rate);
  return {
    governmentValue: value,
    formula: 'Government Value = Property Area (Sq. Mtr.) × Jantri Rate (per Sq. Mtr.)',
    calculation: `${num(areaSqmt)} × ${num(rate)} = ${inr(value)}`,
  };
}

module.exports = { normalizeUnit, toSqmt, governmentValue, SQMT_PER_UNIT, UNIT_LABEL, inr };
