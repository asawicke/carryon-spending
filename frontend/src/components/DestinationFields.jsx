import React from 'react';
import countries from '../data/countries.json';
import CurrencySelect from './CurrencySelect';
export default function DestinationFields({ stops, onChange, start, end, minDate, prefix = 'stop' }) {
  const update = (id, key, value) => onChange(stops.map((row) => row.id === id ? { ...row, [key]: value } : row));
  return <fieldset className="destination-fields"><legend>Destinations and local currencies</legend><p className="field-help">Assign each trip day to one destination, including travel days. Each stop can use a different currency.</p>
    {stops.map((stop, index) => <div className="destination-card" key={stop.id}><div className="section-heading"><h3>Stop {index + 1}</h3>{stops.length > 1 && <button type="button" className="text-link" onClick={() => onChange(stops.filter((row) => row.id !== stop.id))}>Remove stop {index + 1}</button>}</div>
      <label className="field-label" htmlFor={prefix + '-place-' + stop.id}>City or destination</label><input className="text-input" id={prefix + '-place-' + stop.id} required maxLength="100" value={stop.place} onChange={(e) => update(stop.id, 'place', e.target.value)}/>
      <label className="field-label" htmlFor={prefix + '-country-' + stop.id}>Country</label><select className="text-input" id={prefix + '-country-' + stop.id} required value={stop.country} onChange={(e) => update(stop.id, 'country', e.target.value)}><option value="">Choose a country</option>{countries.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}</select>
      <label className="field-label" htmlFor={prefix + '-currency-' + stop.id}>Local currency</label><CurrencySelect id={prefix + '-currency-' + stop.id} value={stop.currency} onChange={(e) => update(stop.id, 'currency', e.target.value)}/>
      <div className="field-grid">{[['startDate', 'First day'], ['endDate', 'Last day']].map(([key, label]) => <div key={key}><label className="field-label" htmlFor={prefix + '-' + key + '-' + stop.id}>{label}</label><input className="text-input" id={prefix + '-' + key + '-' + stop.id} type="date" required min={key === 'endDate' ? stop.startDate || start || minDate : start || minDate} max={end || undefined} value={stop[key]} onChange={(e) => update(stop.id, key, e.target.value)}/></div>)}</div>
    </div>)}
    <p className="field-help">Country names: <a href="https://data.worldbank.org" target="_blank" rel="noopener noreferrer">World Bank</a>. Currency coverage: <a href="https://frankfurter.dev" target="_blank" rel="noopener noreferrer">Frankfurter</a>.</p>
    <button type="button" className="button outline" disabled={stops.length >= 12} onClick={() => onChange([...stops, { id: crypto.randomUUID(), place: '', country: '', currency: stops.at(-1)?.currency || 'EUR', startDate: '', endDate: end || '' }])}>+ Add destination</button>
  </fieldset>;
}
