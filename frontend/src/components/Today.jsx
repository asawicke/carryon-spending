import React, { useState } from 'react';
import Icon from './Icons';
import ExpenseRow from './ExpenseRow';
import { DailySpending } from './TravelerInsights';
import { money, timing, shortDate, localDate } from '../lib';
import { dailyBudget } from '../dailyBudget';
export default function Today({ trip, expenses, summary, userName, onAdd, onEdit, onViewExpenses }) {
  const [whatIf, setWhatIf] = useState('');
  const time = timing(trip), projected = summary.remaining - (Number(whatIf) || 0);
  const percent = Math.min(100, Math.max(0, summary.percentUsed));
  const recent = [...expenses].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const daily = dailyBudget(trip, expenses);
  const hypothetical = dailyBudget(trip, [...expenses, { category: daily.categories[0] || 'Food', amountBase: Number(whatIf) || 0, date: localDate() }]);
  return <>
    <section className="intro"><h1>Hey, {userName}</h1><p>Here’s where you stand on your {trip.destination} trip.</p><p className="trip-phase">{time.phase}</p></section>
    <section className="budget-card" aria-labelledby="budget-heading"><div className="budget-card-top"><span className="eyebrow">Available to spend</span><span className="small-tag">{shortDate(trip.startDate)}–{shortDate(trip.endDate)}</span></div>
      <div className="budget-hero"><div><h2 id="budget-heading">{money(summary.remaining, trip.currency)}</h2><p>left of {money(trip.budget, trip.currency)} budget</p></div><div className="donut" style={{ '--percent': percent + '%' }} role="img" aria-label={Math.round(summary.percentUsed) + ' percent of budget spent'}><div><strong>{Math.round(summary.percentUsed)}%</strong><span>spent</span></div></div></div>
      <div className="budget-guidance"><Icon name="check" size={19}/><span>{summary.remaining < 0 ? money(-summary.remaining, trip.currency) + ' over budget. Review your plan.' : time.remaining ? daily.suggested === null ? 'Set your daily spending categories on Plan.' : money(Math.max(0,daily.remaining), trip.currency) + ' remains for daily spending. Fixed costs and reserve are protected.' : 'Trip complete. ' + money(summary.remaining, trip.currency) + ' remains.'}</span></div>
    </section>
    <button className="add-expense-card" onClick={onAdd}><span className="plus-square"><Icon name="plus"/></span><span><strong>Add an expense</strong><small>Keep your budget up to date</small></span><Icon name="arrow"/></button>
    <DailySpending trip={trip} expenses={expenses}/>
    <section className="impact-card"><span className="eyebrow">Before you buy</span><h2>Can I afford an extra plan?</h2><p>Try a possible purchase to see what would remain.</p><label className="field-label" htmlFor="what-if">Possible purchase ({trip.currency})</label><div className="impact-input"><span>{trip.currency}</span><input id="what-if" type="number" inputMode="decimal" min="0" step=".01" value={whatIf} onChange={(e) => setWhatIf(e.target.value)} placeholder="0.00"/></div>
      {Number(whatIf) > 0 && <div className={'impact-result ' + (projected < 0 ? 'negative' : '')} aria-live="polite"><strong>{projected < 0 ? money(-projected, trip.currency) + ' over budget' : money(projected, trip.currency) + ' would remain'}</strong><span>{time.remaining ? hypothetical.suggested === null ? 'Set daily category budgets on Plan for daily guidance.' : (hypothetical.remaining < 0 ? 'This exceeds your daily spending pool by ' + money(-hypothetical.remaining, trip.currency) + '.' : money(Math.max(0,hypothetical.leftToday), trip.currency) + ' daily spending money left today after this purchase.') + ' Fixed costs and reserve stay protected.' : 'Your trip has ended.'}</span></div>}
    </section>
    <div className="section-heading"><h2>Recent expenses</h2><button className="text-link" onClick={onViewExpenses}>See all <Icon name="arrow" size={16}/></button></div>
    <section className="list-card">{recent.length ? recent.slice(0, 3).map((expense) => <ExpenseRow key={expense.clientId} expense={expense} homeCurrency={trip.currency} onEdit={onEdit}/>) : <p className="empty-list">No expenses yet. Add one to see your balance change.</p>}</section>
  </>;
}
