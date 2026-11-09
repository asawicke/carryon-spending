import React, { useState } from 'react';
import Icon from './Icons';
import FlightPanel from './FlightPanel';
import { PreparationChecklist } from './TravelerInsights';
import { CATEGORIES, EXTRA_COSTS, money } from '../lib';
export default function Plan({ trip, summary, categories, rates, onSave, onNewTrip, onRefresh }) {
  const [budget, setBudget] = useState(String(trip.budget)), [limits, setLimits] = useState({ ...trip.categoryBudgets });
  const [extras, setExtras] = useState(trip.overlookedCosts?.length ? trip.overlookedCosts : EXTRA_COSTS);
  const [preparation, setPreparation] = useState(trip.preparation || {});
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const allocated = Object.values(limits).reduce((s, v) => s + Number(v || 0), 0);
  const extraTotal = extras.filter((r) => r.checked).reduce((s, r) => s + Number(r.estimate || 0), 0);
  const choices = Array.from(new Set([...CATEGORIES.filter((c) => c !== 'Other'), ...categories, ...Object.keys(limits), 'Buffer']));
  async function submit(event) {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true);
    try { await onSave({ budget: Number(budget), categoryBudgets: limits, overlookedCosts: extras, preparation }); setMessage('Plan and checklist saved.'); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <><section className="intro"><h1>Your plan</h1></section>
    <section className="plan-total"><div><span className="eyebrow">Trip budget</span><h2>{money(budget, trip.currency)}</h2><p>{money(summary.remaining, trip.currency)} currently available</p></div><button className="button outline small" onClick={onNewTrip}><Icon name="plus" size={17}/> New trip</button></section>
    <form onSubmit={submit}><div className="section-heading"><h2>Budget by category</h2></div>
      <section className="plan-card"><label className="field-label" htmlFor="total-budget">Total budget ({trip.currency})</label><div className="dollar-input"><span>{trip.currency}</span><input id="total-budget" type="number" min=".01" step=".01" required value={budget} onChange={(e) => setBudget(e.target.value)}/></div>
        <div className="category-list">{choices.map((category) => <label className="category-budget" key={category}><span>{category === 'Buffer' ? 'Buffer / just in case' : category}</span><div className="dollar-input compact"><span>{trip.currency}</span><input type="number" min="0" step=".01" aria-label={category + ' budget'} value={limits[category] ?? ''} onChange={(e) => setLimits((current) => ({ ...current, [category]: e.target.value || 0 }))}/></div></label>)}</div>
        <div className={'allocation ' + (allocated > Number(budget) ? 'over' : '')}><span>Allocated across categories</span><strong>{money(allocated, trip.currency)} / {money(budget, trip.currency)}</strong></div>
        {allocated > Number(budget) && <p className="form-error">Category allocations exceed your total budget.</p>}
      </section><div className="section-heading"><h2>Extra trip costs</h2></div>
      <section className="plan-card"><p className="card-description">Enter your own estimates for costs that are easy to miss. No costs are assumed.</p>{extras.map((item, index) => <div className="extra-row" key={item.id}><label><input type="checkbox" checked={item.checked} onChange={(e) => setExtras((rows) => rows.map((r, i) => i === index ? { ...r, checked: e.target.checked } : r))}/><span>{item.label}</span></label><div className="dollar-input compact"><span>{trip.currency}</span><input type="number" min="0" step=".01" aria-label={item.label + ' estimate'} value={item.estimate} onChange={(e) => setExtras((rows) => rows.map((r, i) => i === index ? { ...r, estimate: e.target.value || 0 } : r))}/></div></div>)}
        <div className="allocation"><span>Potential extra costs</span><strong>{money(extraTotal, trip.currency)}</strong></div><p className="field-help">These are planning reminders. Include them in your category budgets; they are not deducted from your balance until recorded as expenses.</p></section>
      <PreparationChecklist value={preparation} onChange={setPreparation}/>
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="save-message success" role="status">{message}</p>}
      <button className="button primary full plan-save" disabled={busy}>{busy ? 'Saving…' : 'Save plan'} <Icon name="arrow"/></button>
    </form><FlightPanel key={trip.id} trip={trip} rates={rates} onSaved={onRefresh}/>
  </>;
}
