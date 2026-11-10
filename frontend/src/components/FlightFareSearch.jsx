import React, { useEffect, useRef, useState } from 'react';
import FareOffer from './FareOffer';
import AirportPicker from './AirportPicker';
import { api, localDate, money } from '../lib';

export default function FlightFareSearch({ trip, rates, services }) {
  const path = '/api/trips/' + trip.id;
  const [form, setForm] = useState({ origin: '', destination: '', departureDate: trip.startDate < localDate() ? '' : trip.startDate, returnDate: '', nonstop: false });
  const [result, setResult] = useState(null), [saved, setSaved] = useState([]), [bookings, setBookings] = useState({});
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const ids = useRef({});
  async function load() { setSaved(await api(path + '/fare-quotes')); }
  useEffect(() => { load().catch((e) => setError(e.message)); }, [path]);
  const change = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setResult(null); setBookings({}); setMessage(''); setError(''); };
  async function search(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage(''); setResult(null); setBookings({});
    if (!form.origin || !form.destination) { setError('Choose a departure and arrival airport, or enter their three-letter IATA codes.'); setBusy(false); return; }
    try {
      const data = await api(path + '/fare-search', { method: 'POST', body: JSON.stringify(form) });
      setResult(data);
      setMessage(data.offers.length ? data.offers.length + ' fare estimates found.' : 'No verified fare estimates were returned. Try another route or date, or enter a fare from the airline manually.');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function select(offer, action) {
    setBusy(true); setError(''); setMessage('');
    const selection = { searchId: result.searchId, offerId: offer.offerId };
    try {
      if (action === 'save') {
        const identity = result.searchId + ':' + offer.offerId;
        ids.current[identity] ||= crypto.randomUUID();
        await api(path + '/fare-quotes', { method: 'POST', body: JSON.stringify({ ...selection, clientId: ids.current[identity] }) });
        await load(); setMessage('Estimate saved. Your spending and budget have not changed. Record a ticket below only after paying.');
      } else {
        const data = await api(path + '/fare-booking-links', { method: 'POST', body: JSON.stringify(selection) });
        setBookings((previous) => ({ ...previous, [offer.offerId]: data }));
        setMessage(data.options.length ? 'Booking options ready. Confirm the total on the seller’s website.' : 'No secure booking links were returned. Check the airline directly.');
      }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="fare-search" aria-labelledby="fare-search-heading" aria-busy={busy}>
    <h3 id="fare-search-heading">Find a flight estimate</h3>
    {services?.fareSearch === false && <p className="form-error">Flight search needs a server API key. Open Settings → Connection and services for setup information. You can still enter purchased tickets below.</p>}
    <p className="card-description">Compare fares with your plan before buying. Searches are for one adult in economy, priced in the US market. Returned currencies are shown explicitly.</p>
    <form onSubmit={search}><fieldset disabled={busy} className="fare-fields"><legend className="sr-only">Flight search</legend>
      <div className="field-grid">{[['origin', 'From city or airport'], ['destination', 'To city or airport']].map(([key, label]) => <AirportPicker key={key} id={'fare-' + key} label={label} value={form[key]} disabled={busy} onChange={(value) => change(key, value)}/>)}</div><p className="field-help">Fare search uses IATA airport/metro codes. Airports without a supported IATA code cannot be searched here; try a nearby commercial airport. Finding airports uses one provider request and is cached for a week.</p>
      <div className="field-grid"><div><label className="field-label" htmlFor="fare-departure">Departure</label><input className="text-input" id="fare-departure" type="date" required min={localDate()} value={form.departureDate} onChange={(e) => change('departureDate', e.target.value)}/></div>
        <div><label className="field-label" htmlFor="fare-return">Return (optional)</label><input className="text-input" id="fare-return" type="date" min={form.departureDate || localDate()} value={form.returnDate} onChange={(e) => change('returnDate', e.target.value)}/></div></div>
      <label className="check-option"><input type="checkbox" checked={form.nonstop} onChange={(e) => change('nonstop', e.target.checked)}/>Nonstop only</label>
      <button className="button primary full">{busy ? 'Working…' : 'Search fares'}</button>
    </fieldset></form>
    <p className="field-help">Searches can take up to a minute. Estimates are cached for 15 minutes; Ignav may reuse results for up to 30 minutes. No automatic searches or price alerts run.</p>
    <div role="status" aria-live="polite">{busy ? 'Contacting the flight provider…' : message}</div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {result && <div><p className="field-help">{result.cached ? 'Cached search' : 'Search completed'} · checked {result.checkedAt}. {result.omittedCount > 0 ? 'Unverified or additional fares were omitted; showing up to 20 verified results.' : ''}</p>
      {result.offers.map((offer) => <FareOffer key={offer.offerId} offer={{ ...offer, source: result.source, observedAt: result.observedAt }} trip={trip} rates={rates}>
        <div className="fare-actions"><button className="button outline" disabled={busy} onClick={() => select(offer, 'save')}>Save estimate</button><button className="button outline" disabled={busy} onClick={() => select(offer, 'book')}>Check booking options</button></div>
        {bookings[offer.offerId] && <div className="booking-options"><p>Choose one seller from each purchase below to cover the trip. Separate purchases may have different conditions.</p>
          {bookings[offer.offerId].updatedQuote && <p>Latest provider estimate: {money(bookings[offer.offerId].updatedQuote.amount, bookings[offer.offerId].updatedQuote.currency)}. It may differ from your saved estimate.</p>}
          {bookings[offer.offerId].options.map((option, index) => <div key={index}><strong>Purchase {index + 1}: {option.legs.join(' + ') || 'check coverage with seller'}</strong><ul>{option.links.map((link) => <li key={link.url}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.provider} (opens new tab)</a>{link.specificity === 'search_results' ? ' · select your flight again' : ' · confirm flight and fare'}</li>)}</ul></div>)}
        </div>}
      </FareOffer>)}
    </div>}
    {saved.length > 0 && <details className="saved-fare-quotes"><summary>Saved fare estimates ({saved.length})</summary><p className="field-help">Historical snapshots, not tickets or current offers. These amounts are not deducted from your budget. Search again for current availability.</p>
      {saved.map((offer) => <FareOffer key={offer.id} offer={offer} trip={trip} rates={rates}/>)}</details>}
  </section>;
}
