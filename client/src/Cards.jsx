import React, { useEffect, useState } from 'react';
import { AREA_UNITS, FIELDS, PDF_TYPES, PROPERTY_TYPES, STATUS, TYPES_BY_AREA } from './constants.js';

const rupees = (n) => `₹ ${Number(n).toLocaleString('en-IN')}`;

function missingFields(f) {
  const missing = [];
  if (!f.district) missing.push('District');
  if (!f.village) missing.push('Village');
  if (!f.propertyType) missing.push('Property type');
  if (f.tps && !f.fp && !f.rsNo) missing.push('FP No.');
  if (!f.tps && !f.rsNo && !f.blNo && !f.fp) missing.push('Survey No.');
  if (f.area && !(Number(f.area) > 0)) missing.push('a valid area');
  return missing;
}

// Optional property area, used to work out the government value.
function AreaFields({ f, set, disabled }) {
  return (
    <>
      <label>
        <span>Property area (optional)</span>
        <input value={f.area || ''} onChange={set('area')} disabled={disabled} inputMode="decimal" />
      </label>
      <label>
        <span>Area unit</span>
        <select value={f.areaUnit || 'sqmt'} onChange={set('areaUnit')} disabled={disabled}>
          {Object.entries(AREA_UNITS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
    </>
  );
}

// Editable summary of what was read from a typed address.
export function DetailsCard({ initial, disabled, districts, onSearch }) {
  const [f, setF] = useState(() => ({ ...initial, propertyType: initial.propertyType || '', pdfType: initial.pdfType || '', areaUnit: 'sqmt' }));
  const set = (key) => (e) => setF((old) => ({ ...old, [key]: e.target.value }));
  const missing = missingFields(f);

  return (
    <div className="card details">
      <h3>Property details</h3>
      <datalist id="districts">{districts.map((d) => <option key={d} value={d} />)}</datalist>
      <div className="grid">
        {FIELDS.map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input value={f[key] || ''} onChange={set(key)} disabled={disabled} list={key === 'district' ? 'districts' : undefined} />
          </label>
        ))}
        <label>
          <span>Property type</span>
          <select value={f.propertyType} onChange={set('propertyType')} disabled={disabled}>
            <option value="">Choose...</option>
            {Object.entries(PROPERTY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="wide">
          <span>Area type</span>
          <select value={f.pdfType} onChange={set('pdfType')} disabled={disabled}>
            <option value="">Find automatically from the village</option>
            {Object.entries(PDF_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <AreaFields f={f} set={set} disabled={disabled} />
      </div>
      {missing.length > 0 && <p className="hint">Still needed: {missing.join(', ')}</p>}
      <button className="primary" disabled={disabled || missing.length > 0} onClick={() => onSearch(f)}>
        Search Jantri rate
      </button>
    </div>
  );
}

const EMPTY = { district: '', pdfType: '', taluka: '', village: '', tps: '', fp: '', rsNo: '', blNo: '', propertyType: '', area: '', areaUnit: 'sqmt' };

// Pick everything from lists: District -> Area type -> Taluka -> Village -> TPS, then type the plot number.
export function SelectCard({ districts, disabled, onSearch }) {
  const [f, setF] = useState(EMPTY);
  const [kinds, setKinds] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!f.district) return undefined;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/places?district=${encodeURIComponent(f.district)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setKinds(data);
        setF((old) => ({ ...old, pdfType: data[0]?.kind || '' }));
      })
      .catch(() => !cancelled && setKinds([]))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [f.district]);

  const kind = kinds.find((k) => k.kind === f.pdfType);
  const taluka = kind?.talukas.find((t) => t.name === f.taluka);
  const village = taluka?.villages.find((v) => v.name === f.village);
  const urban = f.pdfType && f.pdfType !== 'RURAL_NA';
  const hasTps = urban && village && village.tps.length > 0;
  // a TP scheme section (chosen by TPS number, or an Ahmedabad-style section name) lists FP numbers
  const askFp = Boolean(f.tps) || Boolean(urban && village?.fpList);
  const types = TYPES_BY_AREA[f.pdfType] || Object.keys(PROPERTY_TYPES);

  // changing a field clears everything that depends on it
  const pick = (key, reset) => (e) => setF((old) => ({ ...old, ...reset, [key]: e.target.value }));
  const below = {
    district: { pdfType: '', taluka: '', village: '', tps: '', fp: '', rsNo: '', blNo: '', propertyType: '' },
    pdfType: { taluka: '', village: '', tps: '', fp: '', rsNo: '', blNo: '', propertyType: '' },
    taluka: { village: '', tps: '', fp: '', rsNo: '', blNo: '' },
    village: { tps: '', fp: '', rsNo: '', blNo: '' },
    tps: { fp: '', rsNo: '', blNo: '' },
  };
  const pickVillage = (e) => {
    const v = taluka.villages.find((x) => x.name === e.target.value);
    // a village that only exists as TPS sections starts on its first TPS
    setF((old) => ({ ...old, ...below.village, village: e.target.value, tps: v && !v.plain && v.tps.length ? v.tps[0] : '' }));
  };

  const missing = missingFields(f);
  const off = disabled;

  return (
    <div className="card details">
      <h3>Select property details</h3>
      <div className="grid">
        <label>
          <span>District</span>
          <select value={f.district} onChange={pick('district', below.district)} disabled={off}>
            <option value="">Select district</option>
            {districts.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label>
          <span>Area type</span>
          <select value={f.pdfType} onChange={pick('pdfType', below.pdfType)} disabled={off || !kinds.length}>
            {!kinds.length && <option value="">{loading ? 'Loading...' : 'Select district first'}</option>}
            {kinds.map((k) => <option key={k.kind} value={k.kind}>{PDF_TYPES[k.kind]}</option>)}
          </select>
        </label>
        <label>
          <span>Taluka</span>
          <select value={f.taluka} onChange={pick('taluka', below.taluka)} disabled={off || !kind}>
            <option value="">Select taluka</option>
            {kind?.talukas.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        </label>
        <label>
          <span>{urban ? 'Village / Ward' : 'Village / Moje'}</span>
          <select value={f.village} onChange={pickVillage} disabled={off || !taluka}>
            <option value="">Select village</option>
            {taluka?.villages.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        </label>
        {hasTps && (
          <label className="wide">
            <span>TPS No.</span>
            <select value={f.tps} onChange={pick('tps', below.tps)} disabled={off}>
              {village.plain && <option value="">No TPS (search by Survey No.)</option>}
              {village.tps.map((t) => <option key={t} value={t}>TPS-{t}</option>)}
            </select>
          </label>
        )}
        {askFp ? (
          <label className="wide">
            <span>FP No. (Final Plot)</span>
            <input value={f.fp} onChange={pick('fp')} disabled={off || !village} placeholder="e.g. 327" inputMode="numeric" />
          </label>
        ) : (
          <>
            <label>
              <span>{urban ? 'Survey / City Survey No.' : 'Survey (RS) No.'}</span>
              <input value={f.rsNo} onChange={pick('rsNo')} disabled={off || !village} placeholder="e.g. 398" />
            </label>
            <label>
              <span>Block No. (optional)</span>
              <input value={f.blNo} onChange={pick('blNo')} disabled={off || !village} placeholder="e.g. 581" />
            </label>
          </>
        )}
        <label className="wide">
          <span>Property type</span>
          <select value={f.propertyType} onChange={pick('propertyType')} disabled={off}>
            <option value="">Select property type</option>
            {types.map((k) => <option key={k} value={k}>{PROPERTY_TYPES[k]}</option>)}
          </select>
        </label>
        <AreaFields f={f} set={(key) => pick(key)} disabled={off} />
      </div>
      {f.district && !loading && !kinds.length && <p className="hint">No readable PDF for this district.</p>}
      {f.village && missing.length > 0 && <p className="hint">Still needed: {missing.join(', ')}</p>}
      <button className="primary" disabled={off || !f.village || missing.length > 0} onClick={() => onSearch(f)}>
        Search Jantri rate
      </button>
    </div>
  );
}

export function ProgressCard({ steps, done, failed }) {
  return (
    <div className="card progress">
      <h3>{done ? (failed ? 'Search stopped' : 'Search finished') : 'Bot is working...'}</h3>
      <ol>
        {steps.map((s, i) => {
          const active = !done && i === steps.length - 1;
          return (
            <li key={s.key || i} className={active ? 'active' : failed && i === steps.length - 1 ? 'failed' : 'done'}>
              <i />{s.text}
            </li>
          );
        })}
        {steps.length === 0 && <li className="active"><i />Starting</li>}
      </ol>
    </div>
  );
}

// Near misses and competing entries. Shown for information only - never as the property's rate.
function Alternatives({ title, items }) {
  if (!items?.length) return null;
  return (
    <div className="alternatives">
      <h4>{title}</h4>
      <p className="warning">Not verified. Check each one by hand before using it.</p>
      <ul>
        {items.map((s, i) => (
          <li key={i}>
            <span>{s.description}</span>
            {s.rate != null && <em>{rupees(s.rate)} per sq. mt.{s.rateCategory ? ` (${s.rateCategory})` : ''}</em>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ResultCard({ result, screenshots, onZoom }) {
  const status = STATUS[result.status] || STATUS.error;
  const q = result.query || {};
  const verified = result.status === 'verified';
  const rows = [
    ['Source document', result.pdf],
    ['Section', result.section],
    ['Page', result.page],
    ['Zone', result.zone],
    ['Matched entry', result.matched && `${result.matched.field} ${result.matched.found}${result.listLabel ? ` (list: ${result.listLabel})` : ''}`],
    ['Property type', PROPERTY_TYPES[q.propertyType] || q.propertyType],
  ].filter(([, v]) => v);

  return (
    <div className="card result">
      <span className={`badge ${status.tone}`}>{status.label}</span>
      {verified ? (
        <div className="rate">
          <strong>{rupees(result.rate)}</strong>
          <span>per sq. mt. &middot; {result.rateLabel} &middot; Jantri 2011</span>
          {result.ratePerAcre != null && <span>Also printed as {rupees(result.ratePerAcre)} per acre</span>}
        </div>
      ) : (
        <div className="rate none"><strong>{result.message}</strong></div>
      )}
      {!verified && <p className="review">No rate is returned for this property. Manual verification is required.</p>}

      {result.valuation && (
        <div className="valuation">
          <h4>Government value</h4>
          <dl>
            <dt>Property area</dt>
            <dd>{result.area.areaSqmt.toLocaleString('en-IN', { maximumFractionDigits: 4 })} Sq. Mtr.{result.area.conversion ? ` (${result.area.conversion})` : ''}</dd>
            <dt>Jantri rate</dt><dd>{rupees(result.rate)} per Sq. Mtr.</dd>
            <dt>Calculation</dt><dd>{result.valuation.calculation}</dd>
            <dt>Government value</dt><dd><strong>{rupees(result.valuation.governmentValue)}</strong></dd>
          </dl>
          <p className="fineprint">{result.valuation.formula}. No other charges or factors are applied.</p>
        </div>
      )}
      {verified && result.area == null && <p className="fineprint">Add the property area to get the government value.</p>}

      {rows.length > 0 && (
        <dl>
          {rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
          {result.source && <><dt>Source link</dt><dd><a href={result.source.url} target="_blank" rel="noreferrer">{result.source.url}</a></dd></>}
        </dl>
      )}

      <Alternatives title="Entries that list this number" items={result.candidates} />
      <Alternatives title="Suggestions" items={result.suggestions} />

      {verified && Object.keys(result.values || {}).length > 0 && (
        <details>
          <summary>All rates in this entry</summary>
          <dl>
            {Object.entries(result.values).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v.toLocaleString('en-IN')}</dd></React.Fragment>)}
          </dl>
        </details>
      )}

      {result.notes?.length > 0 && <ul className="notes">{result.notes.map((n) => <li key={n}>{n}</li>)}</ul>}

      {screenshots?.map((s) => (
        <figure key={s.url}>
          <img src={s.url} alt={s.caption} onClick={() => onZoom(s.url)} />
          <figcaption>
            <span>
              {s.caption} &middot; page {s.page}
              {s.role === 'match' && verified && (s.checked ? ' · highlighted cell matches the rate' : '')}
            </span>
            <button className="link" onClick={() => onZoom(s.pageUrl)}>Full page</button>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
