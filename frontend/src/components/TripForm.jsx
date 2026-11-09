import React, { useState } from 'react';
import Icon from './Icons';
import { CURRENCIES, positiveAmount } from '../lib';
export default function TripForm({ onCreate, onCancel }) {
  const [form, setForm] = useState({ name: '', destination: '', startDate: '', endDate: '', budget: '', currency: 'USD', localCurrency: 'EUR' });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault(); setError('');
    if (!positiveAmount(form.budget)) { setError('Enter a budget greater than zero with up to two decimal places.'); return; }
    if (form.endDate < form.startDate) { setError('The end date must be on or after the start date.'); return; }
    setBusy(true);
    try { await onCreate({ ...form, budget: Number(form.budget) }); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section aria-labelledby="new-trip-heading"><div className="intro"><h1 id="new-trip-heading" tabIndex="-1">Add new trip</h1></div>
    <form className="plan-card" onSubmit={submit}>
      <label className="field-label" htmlFor="trip-name">Trip name</label><input id="trip-name" className="text-input" maxLength="100" required value={form.name} onChange={(e) => update('name', e.target.value)}/>
      <label className="field-label" htmlFor="trip-destination">Destination</label><input id="trip-destination" className="text-input" maxLength="100" required value={form.destination} onChange={(e) => update('destination', e.target.value)}/>
      <div className="field-grid">{[['startDate', 'Start date'], ['endDate', 'End date']].map(([key, label]) => <div key={key}><label className="field-label" htmlFor={key}>{label}</label><input id={key} className="text-input" type="date" required min={key === 'endDate' ? form.startDate : undefined} value={form[key]} onChange={(e) => update(key, e.target.value)}/></div>)}</div>
      <label className="field-label" htmlFor="trip-budget">Total budget (USD)</label><input id="trip-budget" className="text-input" type="number" min="0.01" step="0.01" required value={form.budget} onChange={(e) => update('budget', e.target.value)}/>
      <label className="field-label" htmlFor="trip-local">Local currency</label><select id="trip-local" className="text-input" value={form.localCurrency} onChange={(e) => update('localCurrency', e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="button primary" disabled={busy}>{busy ? 'Creating…' : 'Create trip'} <Icon name="plus"/></button>{onCancel && <button className="button outline" type="button" onClick={onCancel}>Cancel</button>}</div>
    </form></section>;
}
