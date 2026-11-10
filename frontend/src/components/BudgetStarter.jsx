import React, { useState } from 'react';
import { api, money } from '../lib';
export default function BudgetStarter({ trip, budget, limits, onApply }) {
  const [fixed, setFixed] = useState(() => Object.fromEntries(['Flights', 'Stay', 'Transit'].map((key) => [key, limits[key] || 0])));
  const [reserve, setReserve] = useState(limits.Buffer ?? Math.round(Number(budget) * 10) / 100);
  const [result, setResult] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function suggest() {
    setBusy(true); setError(''); setResult(null);
    try { setResult(await api('/api/trips/' + trip.id + '/budget-suggestion', { method: 'POST', body: JSON.stringify({ budget: Number(budget), fixedCosts: fixed, reserve }) })); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <details className="budget-starter"><summary>Help me split my budget</summary><p className="card-description">Start with costs you already know. The remainder becomes day-to-day spending. A 10% emergency reserve is an editable starting assumption, not a financial rule.</p>
    <div className="field-grid">{['Flights', 'Stay', 'Transit'].map((key) => <div key={key}><label className="field-label" htmlFor={'fixed-' + key}>{key} estimate ({trip.currency})</label><input className="text-input" id={'fixed-' + key} type="number" min="0" step=".01" value={fixed[key]} onChange={(e) => setFixed({ ...fixed, [key]: e.target.value })}/></div>)}<div><label className="field-label" htmlFor="reserve-estimate">Emergency reserve ({trip.currency})</label><input className="text-input" id="reserve-estimate" type="number" min="0" step=".01" value={reserve} onChange={(e) => setReserve(e.target.value)}/></div></div>
    <button type="button" className="button outline" disabled={busy} onClick={suggest}>{busy ? 'Calculating…' : 'Preview suggestion'}</button>
    {error && <p role="alert" className="form-error">{error}</p>}{result && <div className="suggestion-preview" role="status"><p>{result.explanation}</p><dl className="suggestion-values">{Object.entries(result.categoryBudgets).map(([key, value]) => <div key={key}><dt>{key === 'Buffer' ? 'Emergency reserve' : key}</dt><dd>{money(value, trip.currency)}</dd></div>)}</dl>
      {result.destinations.length > 0 && <><p>{result.countryNote}</p><ul>{result.destinations.map((stop) => <li key={stop.id}>{stop.place}: about {money(stop.dailyEstimate, trip.currency)} per day{stop.priceLevel ? ' · ' + stop.source + ', ' + stop.priceLevel.year : ' · no recent country index; equal weight used'}</li>)}</ul></>}
      <button type="button" className="button primary" onClick={() => { onApply(result.categoryBudgets); setResult(null); }}>Use this editable split</button><p className="field-help">This replaces your category allocations. Review them and use Save plan to keep the changes. Your recorded expenses are unchanged.</p>
    </div>}
  </details>;
}
