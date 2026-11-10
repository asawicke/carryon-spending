import React from 'react';
import { localDate, money, timing, byCategory, PREPARATION } from '../lib';
import { dailyBudget } from '../dailyBudget';
export function DailySpending({ trip, expenses }) {
  const guidance = dailyBudget(trip, expenses), time = guidance.time, spent = guidance.spentToday;
  const target = guidance.target, left = guidance.leftToday;
  return <section aria-labelledby="daily-heading"><div className="section-heading"><h2 id="daily-heading">Daily spending</h2></div>
    <div className="daily-grid"><div className="metric-card"><span className="eyebrow">Spent today</span><strong>{money(spent, trip.currency)}</strong><small>{localDate()} · {trip.currency}</small></div>
      <div className="metric-card"><span className="eyebrow">{time.active ? 'Today’s daily target' : 'Suggested daily target'}</span><strong>{target === null ? 'Set on Plan' : money(target, trip.currency)}</strong><small>Daily categories only · fixed costs and reserve excluded</small></div></div>
    {time.active && target !== null ? <p className={'pace-note ' + (left < 0 ? 'over' : '')}>{left < 0 ? 'Over today’s target by ' + money(-left, trip.currency) : money(left, trip.currency) + ' left for daily spending today'}. {money(Math.max(0,guidance.remaining), trip.currency)} remains for daily categories.</p> : <p className="field-help">{time.phase}. {guidance.planned > 0 ? 'Daily guidance starts when your trip begins.' : 'Use Help me split my budget on Plan to set aside fixed costs and daily spending.'}</p>}
    {guidance.destination && <p className="field-help">{guidance.destination.place}{guidance.destination.priceLevel ? ' · daily split weighted by World Bank GDP price level index (' + guidance.destination.priceLevel.year + '). This is a broad country comparison, not a tourist price quote.' : ' · no recent country price index; equal daily weight used.'} <a href="https://data.worldbank.org/indicator/PA.NUS.GDP.PLI" target="_blank" rel="noopener noreferrer">Source: World Bank</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>).</p>}
  </section>;
}
export function CategoryBudgets({ trip, expenses }) {
  const totals = byCategory(expenses);
  const categories = Array.from(new Set([...Object.keys(trip.categoryBudgets), ...totals.map((r) => r.category)])).filter((c) => c !== 'Buffer');
  return <section className="plan-card" aria-labelledby="category-budget-heading"><h2 id="category-budget-heading">Category budgets remaining</h2>
    {categories.length ? categories.map((category) => {
      const planned = Number(trip.categoryBudgets[category] || 0), spent = totals.find((r) => r.category === category)?.total || 0;
      const remaining = planned - spent;
      return <div className="category-progress" key={category}><div><strong>{category}</strong><span>{planned ? (remaining < 0 ? money(-remaining, trip.currency) + ' over' : money(remaining, trip.currency) + ' left') : 'No budget set'}</span></div>
        {planned > 0 && <progress value={Math.min(spent, planned)} max={planned} aria-label={category + ': ' + money(spent, trip.currency) + ' spent of ' + money(planned, trip.currency)}/>}
        <small>{money(spent, trip.currency)} spent{planned > 0 ? ' / ' + money(planned, trip.currency) + ' planned' : ''}</small></div>;
    }) : <p className="field-help">Set category budgets on Plan to see what remains.</p>}
  </section>;
}
export function PreparationChecklist({ value, onChange }) {
  return <section className="plan-card" aria-labelledby="preparation-heading"><h2 id="preparation-heading">Before you go</h2><p className="card-description">General reminders. Requirements depend on your nationality, destination, and dates.</p>
    <div className="preparation-list">{PREPARATION.map(([id, label, hint]) => <label key={id}><input type="checkbox" checked={Boolean(value[id])} onChange={(e) => onChange({ ...value, [id]: e.target.checked })}/><span><strong>{label}</strong><small>{hint}</small></span></label>)}</div>
    <p className="field-help">Use Save plan to keep your checklist. Checking an item does not record an expense.</p>
  </section>;
}
