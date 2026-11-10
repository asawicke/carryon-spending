import React, { useRef, useState } from 'react';
import { api } from '../lib';
export default function AirportPicker({ id, label, value, onChange, disabled }) {
  const [query, setQuery] = useState(value), [results, setResults] = useState([]), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const sequence = useRef(0);
  async function find() {
    const request = ++sequence.current;
    setBusy(true); setMessage('Finding airports…');
    try {
      const data = await api('/api/airports/search', { method: 'POST', body: JSON.stringify({ query }) });
      if (request !== sequence.current) return;
      setResults(data.airports); setMessage(data.airports.length ? 'Choose an airport below.' : 'No matching airports. Try a nearby city or enter a three-letter IATA code.');
    } catch (e) { if (request === sequence.current) setMessage(e.message); } finally { if (request === sequence.current) setBusy(false); }
  }
  return <div className="airport-picker"><label className="field-label" htmlFor={id}>{label}</label><div className="lookup-row"><input id={id} className="text-input" maxLength="80" value={query} disabled={disabled || busy} placeholder="City, airport, or IATA code" aria-describedby={id + '-help'} onChange={(e) => { const next = e.target.value; setQuery(next); setResults([]); setMessage(''); onChange(/^[a-z]{3}$/i.test(next.trim()) ? next.trim().toUpperCase() : ''); }} onKeyDown={(e) => { if (e.key === 'Enter' && !/^[a-z]{3}$/i.test(query.trim())) { e.preventDefault(); find(); } }}/><button className="button outline" type="button" disabled={disabled || busy || query.trim().length < 2} onClick={find}>{busy ? 'Finding…' : 'Find'}</button></div>
    <p id={id + '-help'} className="field-help">Type a city and choose Find, or enter a three-letter IATA code. {value ? 'Selected: ' + value + '.' : 'Choose an airport before searching fares.'}</p>
    <div role="status" className="field-help">{message}</div>{results.length > 0 && <><label className="field-label" htmlFor={id + '-results'}>Matching airports</label><select id={id + '-results'} className="text-input" value={value} onChange={(e) => { onChange(e.target.value); const selected = results.find((row) => row.code === e.target.value); if (selected) setQuery(selected.city + ' · ' + selected.code); }}><option value="">Choose an airport</option>{results.map((row) => <option key={row.code} value={row.code}>{row.city} · {row.name} ({row.code}, {row.country})</option>)}</select></>}
  </div>;
}
