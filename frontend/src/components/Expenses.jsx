import React from 'react';
import Icon from './Icons';
import ExpenseRow from './ExpenseRow';
import SpendingCharts from './SpendingCharts';
import { CategoryBudgets, DailySpending } from './TravelerInsights';
import { money, timing, PREPARATION } from '../lib';
export default function Expenses({ trip, expenses, summary, onAdd, onEdit, onDelete, onPlan }) {
  const checked = PREPARATION.filter(([id]) => trip.preparation?.[id]).length;
  return <><section className="intro"><span className="eyebrow">Every little thing</span><h1>Expenses</h1><p>See where your money is going, in one place.</p></section>
    <section className="expenses-total"><span className="eyebrow">Total spent</span><h2>{money(summary.spent, trip.currency)}</h2><p>{expenses.length} expenses logged · {timing(trip).phase}</p></section>
    <div className="section-heading"><h2>By category</h2></div><SpendingCharts expenses={expenses} currency={trip.currency}/>
    <DailySpending trip={trip} expenses={expenses}/><CategoryBudgets trip={trip} expenses={expenses}/>
    <div className="preparation-summary"><span>Before you go: {checked} of {PREPARATION.length} checks complete</span><button className="text-link" onClick={onPlan}>Review on Plan <Icon name="arrow" size={16}/></button></div>
    <div className="section-heading"><h2>All expenses</h2><button className="text-link" onClick={onAdd}><Icon name="plus" size={17}/> Add</button></div>
    <section className="list-card">{expenses.length ? expenses.map((expense) => <ExpenseRow key={expense.clientId} expense={expense} homeCurrency={trip.currency} onEdit={onEdit} onDelete={onDelete}/>) : <p className="empty-list">No expenses yet. Add your first purchase.</p>}</section>
    <p className="field-help">Each expense shows its saved home-currency value and original currency amount. Converted values are reference estimates; your bank statement is the final charge.</p>
  </>;
}
