import React from 'react';
import { money } from '../lib';
export default function SavedFlights({ flights, currency }) {
  return <div aria-live="polite">{flights.length ? flights.map((flight) => <article className="saved-flight" key={flight.id}>
    <h3>{flight.flightNumber} · {flight.origin} → {flight.destination}</h3><p>{flight.departureDate}{flight.departureTime ? ' · ' + flight.departureTime + ' (departure airport local time)' : ''}</p>
    <p>Status: {flight.status}. Source: {flight.source}{flight.checkedAt ? ' · Last checked ' + flight.checkedAt : ''}.</p>
    <p>Fare entered: {money(flight.fare, flight.currency)}. {flight.expenseId ? 'Recorded in Flights expenses.' : 'Itinerary only; not deducted from your ' + currency + ' budget.'}</p>
  </article>) : <p className="field-help">No flights saved yet. Add ticket details below, or look up a current flight.</p>}</div>;
}
