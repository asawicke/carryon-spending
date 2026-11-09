import React from 'react';
import { estimate, money } from '../lib';

export default function FareOffer({ offer, trip, rates, children }) {
  const home = estimate(offer.amount, offer.currency, trip.currency, rates);
  const budget = Number(trip.categoryBudgets.Flights || trip.categoryBudgets.Transit || 0);
  return <article className="saved-flight fare-offer">
    <h4>From {money(offer.amount, offer.currency)} · {offer.legs.length > 1 ? 'round trip' : 'one way'}</h4>
    <p>1 adult · economy · total itinerary estimate</p>
    {offer.legs.map((leg) => <div key={leg.direction} className="fare-leg">
      <strong>{leg.direction === 'inbound' ? 'Return' : 'Outbound'}{leg.carrier ? ' · ' + leg.carrier : ''}</strong>
      <p>{leg.segments.length === 1 ? 'Nonstop' : (leg.segments.length - 1) + ' stop(s)'}</p>
      <ul>{leg.segments.map((segment, index) => <li key={index}>
        {segment.marketing_carrier_code}{segment.flight_number} · {segment.departure_airport} → {segment.arrival_airport}<br/>
        {segment.departure_time_local.replace('T', ' ')} → {segment.arrival_time_local.replace('T', ' ')} (each airport’s local time)
      </li>)}</ul>
    </div>)}
    <p>{home === null ? 'Home-currency estimate unavailable.' : 'About ' + money(home, trip.currency) +
      (budget ? ' · ' + (home / budget * 100).toFixed(1) + '% of your ' + (trip.categoryBudgets.Flights ? 'Flights' : 'Transit') + ' budget.' : ' in your home currency.')}</p>
    <p className="field-help">Source: {offer.source || 'Ignav'} · Retrieved {offer.observedAt || 'time not supplied'}. Prices can change; confirm baggage, fees and the final total with the seller.</p>
    {children}
  </article>;
}
