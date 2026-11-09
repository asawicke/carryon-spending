import React, { useEffect, useState } from 'react';
import SavedFlights from './SavedFlights';
import FlightFareSearch from './FlightFareSearch';
import { api, CURRENCIES, estimate, money, localDate } from '../lib';
export default function FlightPanel({ trip, rates, onSaved }) {
  const [flights, setFlights] = useState([]), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [searched, setSearched] = useState(false);
  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({ flightNumber: '', departureDate: '', origin: '', destination: '', fare: '', currency: trip.currency, logExpense: false });
  const [lookup, setLookup] = useState(null);
  const change = (key, value) => { setForm((f) => ({ ...f, [key]: value })); if (['flightNumber', 'origin', 'destination', 'departureDate'].includes(key)) setLookup(null); };
  async function load() { const rows = await api('/api/trips/' + trip.id + '/flights'); setFlights(rows); }
  useEffect(() => { load().catch((e) => setError(e.message)); }, [trip.id]);
  async function search() {
    setBusy(true); setError(''); setMessage(''); setSearched(false); setLookup(null);
    try {
      const result = await api('/api/flights/lookup?number=' + encodeURIComponent(form.flightNumber));
      setSearched(true);
      if (!result.flight) { setMessage('No current flight found. Future dates may not be available. Enter details from your ticket.'); return; }
      const flight = result.flight;
      setForm((f) => ({ ...f, flightNumber: flight.flightNumber, origin: flight.origin, destination: flight.destination, departureDate: flight.departureDate }));
      setLookup(flight.lookupId);
      setMessage('Flight found. Confirm the route and date match your ticket. This is the closest scheduled/live flight, not a future-date search.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      await api('/api/trips/' + trip.id + '/flights', { method: 'POST', body: JSON.stringify({ ...form, fare: Number(form.fare), clientId: submissionId, lookupId: lookup, paymentDate: localDate() }) });
      await load(); await onSaved(); setSubmissionId(crypto.randomUUID());
      setMessage(form.logExpense ? 'Flight saved and actual fare recorded once as a Flights expense.' : 'Flight saved. No expense was recorded.');
      setForm({ flightNumber: '', departureDate: '', origin: '', destination: '', fare: '', currency: trip.currency, logExpense: false }); setLookup(null);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  const home = estimate(form.fare, form.currency, trip.currency, rates);
  const planned = Number(trip.categoryBudgets.Flights || trip.categoryBudgets.Transit || 0);
  return <details className="flight-panel"><summary>Flights · fare search and tickets</summary><div className="flight-body">
    <FlightFareSearch trip={trip} rates={rates}/>
    <h3>Add a ticket you purchased</h3><SavedFlights flights={flights} currency={trip.currency}/>
    <p className="card-description">Enter your actual ticket details below. Optional current-status lookup uses AirLabs and needs a separate server key. Fare search above uses Ignav. CarryOn does not sell or book tickets.</p>
    <form onSubmit={submit}><label className="field-label" htmlFor="flight-number">Flight code on your ticket</label><div className="lookup-row"><input id="flight-number" className="text-input" placeholder="e.g. AA100" required maxLength="10" value={form.flightNumber} onChange={(e) => change('flightNumber', e.target.value.toUpperCase().replace(/\s/g, ''))}/><button type="button" className="button outline" disabled={busy || !form.flightNumber.trim()} onClick={search}>{busy ? 'Working…' : 'Look up'}</button></div>
      <div className="field-grid">{[['origin', 'Departure airport'], ['destination', 'Arrival airport']].map(([key, label]) => <div key={key}><label className="field-label" htmlFor={'flight-' + key}>{label}</label><input id={'flight-' + key} className="text-input" required pattern="[A-Za-z]{3}" maxLength="3" value={form[key]} onChange={(e) => change(key, e.target.value.toUpperCase())} aria-describedby="airport-help"/></div>)}</div><p id="airport-help" className="field-help">Three-letter airport codes, such as DTW or CDG. Some free lookup fields may be unavailable.</p>
      <label className="field-label" htmlFor="flight-date">Departure date (airport local date)</label><input id="flight-date" className="text-input" type="date" required value={form.departureDate} onChange={(e) => change('departureDate', e.target.value)}/>
      <div className="field-grid"><div><label className="field-label" htmlFor="flight-fare">Fare from your ticket</label><input id="flight-fare" className="text-input" type="number" min={form.logExpense ? '.01' : '0'} step=".01" required value={form.fare} onChange={(e) => change('fare', e.target.value)}/></div><div><label className="field-label" htmlFor="flight-currency">Fare currency</label><select id="flight-currency" className="text-input" value={form.currency} onChange={(e) => change('currency', e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div></div>
      {Number(form.fare) > 0 && <p className="field-help" aria-live="polite">{home === null ? 'Home-currency estimate unavailable.' : money(home, trip.currency) + ' estimated · ' + (planned ? (home / planned * 100).toFixed(1) + '% of your ' + (trip.categoryBudgets.Flights ? 'Flights' : 'Transit') + ' budget.' : 'Set a Flights budget to compare this cost.')} This compares with your plan, not typical market fares.</p>}
      <label className="check-option"><input type="checkbox" checked={form.logExpense} onChange={(e) => change('logExpense', e.target.checked)}/>I paid this fare. Record it once as a Flights expense today.</label>
      {lookup && <button type="button" className="text-link" onClick={() => setLookup(null)}>Save as my ticket details instead of provider information</button>}
      {message && <p role="status" className="save-message success">{message}</p>}{error && <p role="alert" className="form-error">{error}</p>}{searched && !lookup && <p className="field-help">Manual ticket details can still be saved.</p>}
      <button className="button primary full" disabled={busy}>{busy ? 'Working…' : 'Save flight'}</button>
    </form><p className="field-help">Status is a saved snapshot, not an airline guarantee. Check your airline for current travel information.</p></div></details>;
}
