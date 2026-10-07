import React, { useEffect, useState } from 'react';
import { FIELDS, PDF_TYPES, PROPERTY_TYPES, STATUS } from './constants.js';

function missingFields(f) {
  const missing = [];
  if (!f.district) missing.push('District');
  if (!f.village) missing.push('Village');
  if (!f.propertyType) missing.push('Property type');
  if (f.pdfType !== 'RURAL_NA' && f.tps && !f.fp) missing.push('FP No.');
  if ((f.pdfType === 'RURAL_NA' || !f.tps) && !f.rsNo && !f.blNo) missing.push('Survey No. or BL No.');
  return missing;
}

// Editable summary of what was read from a typed address.
export function DetailsCard({ initial, disabled, districts, onSearch }) {
  const [f, setF] = useState(() => ({ ...initial, propertyType: initial.propertyType || '' }));
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
            <input value={f[key] || ''} onChange={set(key)} disabled={disabled} placeholder="-" list={key === 'district' ? 'districts' : undefined} />
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
          <span>PDF to search</span>
          <select value={f.pdfType} onChange={set('pdfType')} disabled={disabled}>
            {Object.entries(PDF_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      {missing.length > 0 && <p className="hint">Still needed: {missing.join(', ')}</p>}
      <button className="primary" disabled={disabled || missing.length > 0} onClick={() => onSearch(f)}>
        Search Jantri rate
      </button>
    </div>
  );
}

const EMPTY = { district: '', pdfType: '', taluka: '', village: '', tps: '', fp: '', rsNo: '', blNo: '', propertyType: '' };

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

  // changing a field clears everything that depends on it
  const pick = (key, reset) => (e) => setF((old) => ({ ...old, ...reset, [key]: e.target.value }));
  const below = {
    district: { pdfType: '', taluka: '', village: '', tps: '', fp: '', rsNo: '', blNo: '' },
    pdfType: { taluka: '', village: '', tps: '', fp: '', rsNo: '', blNo: '' },
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
        {f.tps ? (
          <label className="wide">
            <span>FP No. (Final Plot)</span>
            <input value={f.fp} onChange={pick('fp')} disabled={off || !village} placeholder="e.g. 327" inputMode="numeric" />
          </label>
        ) : (
          <>
            <label>
              <span>{urban ? 'Survey / City Survey No.' : 'RS No.'}</span>
              <input value={f.rsNo} onChange={pick('rsNo')} disabled={off || !village} placeholder="e.g. 398" />
            </label>
            <label>
              <span>BL No. (optional)</span>
              <input value={f.blNo} onChange={pick('blNo')} disabled={off || !village} placeholder="e.g. 581" />
            </label>
          </>
        )}
        <label className="wide">
          <span>Property type</span>
          <select value={f.propertyType} onChange={pick('propertyType')} disabled={off}>
            <option value="">Select property type</option>
            {Object.entries(PROPERTY_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
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

export function ResultCard({ result, screenshots, onZoom }) {
  const status = STATUS[result.status] || STATUS.no_data;
  const q = result.query || {};
  const rows = [
    ['PDF', result.pdf],
    ['Section', result.section],
    ['Page', result.page],
    ['Zone', result.zone],
    ['Matched by', result.matched && `${result.matched.field} ${result.matched.value}${result.matched.how === 'neighbour' ? ` (used ${result.matched.found})` : ''}`],
    ['Property type', PROPERTY_TYPES[q.propertyType]],
  ].filter(([, v]) => v);

  return (
    <div className="card result">
      <span className={`badge ${status.tone}`}>{status.label}</span>
      {result.rate != null ? (
        <div className="rate">
          <strong>&#8377; {result.rate.toLocaleString('en-IN')}</strong>
          <span>per sq. mt. &middot; {result.rateLabel}</span>
        </div>
      ) : (
        <div className="rate none"><strong>{result.message}</strong></div>
      )}
      {result.needsReview && <p className="review">Needs a manual check - see the notes below.</p>}

      <dl>
        {rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
      </dl>

      {Object.keys(result.values || {}).length > 0 && (
        <details>
          <summary>All rates in this row</summary>
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
            <span>{s.caption} &middot; page {s.page}</span>
            <button className="link" onClick={() => onZoom(s.pageUrl)}>Full page</button>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
