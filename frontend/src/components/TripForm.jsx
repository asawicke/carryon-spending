import React, { useState } from 'react';
import Icon from './Icons';
import CurrencySelect from './CurrencySelect';
import DestinationFields from './DestinationFields';
import { localDate, positiveAmount } from '../lib';
export default function TripForm({ onCreate, onCancel }) {
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '', budget: '', currency: 'USD', recordPast: false });
  const [stops, setStops] = useState([{ id: crypto.randomUUID(), place: '', country: '', currency: 'EUR', startDate: '', endDate: '' }]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    if ((key === 'startDate' || key === 'endDate') && stops.length === 1) setStops((rows) => [{ ...rows[0], [key]: value }]);
  }
  async function submit(event) {
    event.preventDefault(); setError('');
    if (!positiveAmount(form.budget)) { setError('Enter a budget greater than zero with up to two decimal places.'); return; }
    if (form.endDate < form.startDate) { setError('The end date must be on or after the start date.'); return; }
    setBusy(true);
    try { await onCreate({ ...form, destination: stops.map((row) => row.place.trim()).join(' → ').slice(0,100), localCurrency: stops[0].currency, destinations: stops, budget: Number(form.budget) }); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <section aria-labelledby="new-trip-heading"><div className="intro"><span className="eyebrow">Start with the essentials</span><h1 id="new-trip-heading" tabIndex="-1">Add new trip</h1><p>Next, Plan will help you set aside fixed costs and build an editable daily budget.</p></div>
    <form className="plan-card" onSubmit={submit}><fieldset className="fare-fields" disabled={busy}>
      <label className="field-label" htmlFor="trip-name">Trip name</label><input id="trip-name" className="text-input" maxLength="100" required placeholder="Summer in Europe" value={form.name} onChange={(e) => update('name', e.target.value)}/>
      <label className="check-option"><input type="checkbox" checked={form.recordPast} onChange={(e) => update('recordPast', e.target.checked)}/>Record a past trip instead of planning a future one</label>
      <div className="field-grid">{[['startDate', 'Trip start'], ['endDate', 'Trip end']].map(([key, label]) => <div key={key}><label className="field-label" htmlFor={key}>{label}</label><input id={key} className="text-input" type="date" required min={key === 'endDate' ? form.startDate || (form.recordPast ? undefined : localDate()) : form.recordPast ? undefined : localDate()} value={form[key]} onChange={(e) => update(key, e.target.value)}/></div>)}</div>
      <label className="field-label" htmlFor="trip-home">Home currency</label><CurrencySelect id="trip-home" value={form.currency} onChange={(e) => update('currency', e.target.value)}/>
      <label className="field-label" htmlFor="trip-budget">Total budget ({form.currency})</label><input id="trip-budget" className="text-input" type="number" inputMode="decimal" min="0.01" step="0.01" required value={form.budget} onChange={(e) => update('budget', e.target.value)}/>
      <DestinationFields stops={stops} onChange={setStops} start={form.startDate} end={form.endDate} minDate={form.recordPast ? undefined : localDate()}/>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="button primary">{busy ? 'Creating…' : 'Create trip'} <Icon name="plus"/></button>{onCancel && <button className="button outline" type="button" onClick={onCancel}>Cancel</button>}</div>
    </fieldset></form></section>;
}
