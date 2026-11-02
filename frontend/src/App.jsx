import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const CATEGORIES = ['Food', 'Transit', 'Activities', 'Shopping', 'Stay', 'Other'];
const PLAN_CATEGORIES = ['Stay', 'Transit', 'Food', 'Activities', 'Buffer'];
const DEFAULT_RATES = { base: 'USD', rates: { USD: 1, EUR: 0.92, GBP: 0.79, JPY: 150, CAD: 1.36 }, source: 'Demo estimates' };
const DEMO_EXTRAS = [
  { id: 'visa', label: 'Visa or entry fees', estimate: 0, checked: false },
  { id: 'insurance', label: 'Travel insurance', estimate: 45, checked: false },
  { id: 'airport', label: 'Airport transfer', estimate: 25, checked: false },
  { id: 'data', label: 'eSIM or phone data', estimate: 20, checked: false },
  { id: 'atm', label: 'ATM and card fees', estimate: 15, checked: false },
  { id: 'emergency', label: 'Emergency cushion', estimate: 100, checked: false },
];

function readSaved(key, fallback) {
  try {
    const raw = localStorage.getItem(`carryon:${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(`carryon:${key}`, JSON.stringify(value));
}

function localDate() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function money(amount, currency = 'USD', digits = 0) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(Number(amount) || 0);
}

function shortDate(value) {
  if (!value) return '';
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function tripDates(trip) {
  if (!trip) return '';
  return `${shortDate(trip.startDate)}–${shortDate(trip.endDate)}`;
}

function daysLeft(trip) {
  if (!trip?.endDate) return 1;
  const end = new Date(`${trip.endDate}T12:00:00`);
  const now = new Date(`${localDate()}T12:00:00`);
  const start = new Date(`${trip.startDate || trip.endDate}T12:00:00`);
  if (now < start) return Math.max(1, Math.ceil((end - start) / 86_400_000) + 1);
  return Math.max(1, Math.ceil((end - now) / 86_400_000) + 1);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status})`);
  return body;
}

function PlaneIcon({ size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m2 10 20-8-8 20-4-8-8-4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="m10 14 12-12" stroke="currentColor" strokeWidth="1.8"/></svg>;
}

function Icon({ name, size = 21 }) {
  const paths = {
    today: <><path d="M3 11.5 12 4l9 7.5V21H3v-9.5Z"/><path d="M9 21v-7h6v7"/></>,
    plan: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    expenses: <><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9ZM10 21h4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    close: <path d="M5 5 19 19M19 5 5 19"/>,
    edit: <><path d="m4 17 13-13 3 3L7 20H4v-3Z"/><path d="m15 6 3 3"/></>,
    check: <path d="m4 12 5 5L20 6"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function ExpenseRow({ expense, onEdit }) {
  const native = money(expense.amount, expense.currency, 2);
  const home = money(expense.amountBase, 'USD', 2);
  return <div className="expense-row">
    <div className="expense-mark" aria-hidden="true">{expense.category?.slice(0, 1) || '$'}</div>
    <div className="expense-main">
      <strong>{expense.note || expense.category}</strong>
      <span>{expense.category} · {shortDate(expense.date)}{expense.pending ? ' · Waiting to sync' : ''}</span>
    </div>
    <div className="expense-amount"><strong>{home}</strong><span>{expense.currency !== 'USD' ? native : 'USD'}</span></div>
    <button className="icon-button row-edit" onClick={() => onEdit(expense)} aria-label={`Edit ${expense.note || expense.category}`}><Icon name="edit" size={16} /></button>
  </div>;
}

function ExpenseModal({ trip, rates, expense, onClose, onSave, busy }) {
  const [form, setForm] = useState({
    amount: expense?.amount ?? '',
    currency: expense?.currency ?? trip?.localCurrency ?? 'EUR',
    note: expense?.note ?? '',
    category: expense?.category ?? 'Food',
    date: expense?.date ?? localDate(),
  });
  const [error, setError] = useState('');
  const rate = rates.rates?.[form.currency] || 1;
  const estimate = Number(form.amount) > 0 ? Number(form.amount) / rate : 0;
  const valid = Number(form.amount) > 0 && form.note.trim() && form.category && form.date;

  function update(field, value) { setForm((current) => ({ ...current, [field]: value })); }

  async function submit(event) {
    event.preventDefault();
    if (!valid) return;
    try {
      setError('');
      await onSave({ ...form, amount: Number(form.amount), note: form.note.trim() }, expense);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="expense-title">
      <div className="modal-head"><div><span className="eyebrow">{trip?.destination || 'Your trip'}</span><h2 id="expense-title">{expense ? 'Edit expense' : 'Add an expense'}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
      <form onSubmit={submit}>
        <label className="field-label" htmlFor="expense-amount">Amount</label>
        <div className="amount-field"><select aria-label="Currency" value={form.currency} onChange={(event) => update('currency', event.target.value)}>{Object.keys(rates.rates || DEFAULT_RATES.rates).map((currency) => <option key={currency}>{currency}</option>)}</select><input id="expense-amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" value={form.amount} onChange={(event) => update('amount', event.target.value)} autoFocus /></div>
        <p className="field-help">About {money(estimate, 'USD', 2)} in your home currency · {rates.source || 'Estimated rate'}</p>
        <label className="field-label" htmlFor="expense-note">What was it for?</label>
        <input id="expense-note" className="text-input" maxLength="80" placeholder="e.g. Coffee near the station" value={form.note} onChange={(event) => update('note', event.target.value)} />
        <label className="field-label">Category</label>
        <div className="chip-group" role="group" aria-label="Category">{CATEGORIES.map((category) => <button type="button" key={category} className={`chip ${form.category === category ? 'selected' : ''}`} onClick={() => update('category', category)}>{category}</button>)}</div>
        <label className="field-label" htmlFor="expense-date">Date</label>
        <input id="expense-date" className="text-input" type="date" value={form.date} onChange={(event) => update('date', event.target.value)} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary full" disabled={!valid || busy} type="submit">{busy ? 'Saving…' : expense ? 'Save changes' : 'Save expense'} <Icon name="arrow" size={18}/></button>
      </form>
    </div>
  </div>;
}

function TripModal({ onClose, onCreate, busy }) {
  const [form, setForm] = useState({ name: '', destination: '', startDate: '', endDate: '', budget: '', currency: 'USD', localCurrency: 'EUR' });
  const [error, setError] = useState('');
  const valid = form.name.trim() && form.destination.trim() && Number(form.budget) > 0 && form.startDate && form.endDate && form.endDate >= form.startDate;
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  async function submit(event) {
    event.preventDefault();
    if (!valid) return;
    try {
      setError('');
      await onCreate({ ...form, name: form.name.trim(), destination: form.destination.trim(), budget: Number(form.budget) });
      onClose();
    } catch (err) { setError(err.message); }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="trip-title">
    <div className="modal-head"><div><span className="eyebrow">Make a plan</span><h2 id="trip-title">New trip</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
    <form onSubmit={submit}>
      <label className="field-label" htmlFor="trip-name">Trip name</label><input id="trip-name" className="text-input" placeholder="Summer in Paris" value={form.name} onChange={(e) => update('name', e.target.value)} autoFocus />
      <label className="field-label" htmlFor="trip-destination">Destination</label><input id="trip-destination" className="text-input" placeholder="Paris, France" value={form.destination} onChange={(e) => update('destination', e.target.value)} />
      <div className="field-grid"><div><label className="field-label" htmlFor="trip-start">Start</label><input id="trip-start" className="text-input" type="date" value={form.startDate} onChange={(e) => update('startDate', e.target.value)} /></div><div><label className="field-label" htmlFor="trip-end">End</label><input id="trip-end" className="text-input" type="date" value={form.endDate} onChange={(e) => update('endDate', e.target.value)} /></div></div>
      <div className="field-grid"><div><label className="field-label" htmlFor="trip-budget">Total budget (USD)</label><input id="trip-budget" className="text-input" type="number" min="1" step="0.01" placeholder="1700" value={form.budget} onChange={(e) => update('budget', e.target.value)} /></div><div><label className="field-label" htmlFor="trip-local">Local currency</label><select id="trip-local" className="text-input" value={form.localCurrency} onChange={(e) => update('localCurrency', e.target.value)}>{Object.keys(DEFAULT_RATES.rates).map((c) => <option key={c}>{c}</option>)}</select></div></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button primary full" disabled={!valid || busy}>Create trip <Icon name="arrow" size={18}/></button>
    </form>
  </div></div>;
}

function Today({ trip, expenses, summary, onAdd, onEdit, onViewExpenses, rates }) {
  const [whatIf, setWhatIf] = useState('');
  const days = daysLeft(trip);
  const projected = summary.remaining - (Number(whatIf) || 0);
  const percent = Math.min(100, Math.max(0, summary.percentUsed));
  const recentExpenses = [...expenses].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const todayTotal = expenses.filter((expense) => expense.date === localDate()).reduce((sum, expense) => sum + Number(expense.amountBase || 0), 0);
  const dailyTarget = Number(trip.budget || 0) / Math.max(1, Math.ceil((new Date(`${trip.endDate}T12:00:00`) - new Date(`${trip.startDate}T12:00:00`)) / 86_400_000) + 1);

  return <>
    <section className="intro"><span className="eyebrow">Your money at a glance</span><h1>Hey, Avery <span className="wave" aria-hidden="true">✳</span></h1><p>Here’s where you stand on your {trip.destination} trip.</p></section>
    <section className="budget-card" aria-labelledby="budget-heading">
      <div className="budget-card-top"><span className="eyebrow">Available to spend</span><span className="small-tag">{tripDates(trip)}</span></div>
      <div className="budget-hero"><div><h2 id="budget-heading">{money(summary.remaining)}</h2><p>left of {money(trip.budget)} budget</p></div><div className="donut" style={{ '--percent': `${percent}%` }} aria-label={`${Math.round(percent)} percent of budget spent`}><div><strong>{Math.round(percent)}%</strong><span>spent</span></div></div></div>
      <div className="budget-guidance"><span className="guidance-dot" aria-hidden="true"/><span>{summary.remaining >= 0 ? <>You have about <strong>{money(summary.remaining / days)}</strong> per day available.</> : <>You’re <strong>{money(Math.abs(summary.remaining))}</strong> over budget. Review your plan.</>}</span></div>
    </section>
    <button className="add-expense-card" onClick={onAdd}><span className="plus-square"><Icon name="plus" size={23}/></span><span><strong>Add an expense</strong><small>Keep your budget up to date</small></span><Icon name="arrow" /></button>
    <div className="section-heading"><div><span className="eyebrow">Today</span><h2>Daily spending</h2></div></div>
    <section className="daily-grid"><div className="metric-card"><span className="eyebrow">Spent today</span><strong>{money(todayTotal)}</strong><small>in your home currency</small></div><div className="metric-card"><span className="eyebrow">Daily target</span><strong>{money(dailyTarget)}</strong><small>across your trip</small></div></section>
    <section className="impact-card"><span className="eyebrow">Before you buy</span><h2>Can I afford an extra plan?</h2><p>Try a price for a weekend activity or day trip.</p><div className="impact-input"><span>$</span><input type="number" inputMode="decimal" min="0" step="0.01" value={whatIf} onChange={(e) => setWhatIf(e.target.value)} placeholder="Enter an amount in USD" aria-label="Possible purchase amount in USD" /></div>{Number(whatIf) > 0 && <div className={`impact-result ${projected < 0 ? 'negative' : ''}`}><strong>{projected >= 0 ? `${money(projected)} would remain` : `${money(Math.abs(projected))} over budget`}</strong><span>{projected >= 0 ? `About ${money(projected / days)} per day after this purchase.` : 'Try lowering the cost or adjusting your trip budget.'}</span></div>}</section>
    <div className="section-heading"><div><span className="eyebrow">What you’ve logged</span><h2>Recent expenses</h2></div><button className="text-link" onClick={onViewExpenses}>See all <Icon name="arrow" size={16}/></button></div>
    <section className="list-card">{recentExpenses.length ? recentExpenses.slice(0, 3).map((expense) => <ExpenseRow key={expense.clientId || expense.id} expense={expense} onEdit={onEdit} />) : <div className="empty-list">No expenses yet. Add one to see your balance change.</div>}</section>
    <p className="rate-note">Foreign currency values use {rates.source || 'estimated exchange rates'}.</p>
  </>;
}

function Plan({ trip, summary, onSave, onNewTrip, busy }) {
  const [budget, setBudget] = useState(String(trip.budget || ''));
  const [categories, setCategories] = useState({ ...trip.categoryBudgets });
  const [extras, setExtras] = useState((trip.overlookedCosts?.length ? trip.overlookedCosts : DEMO_EXTRAS).map((item) => ({ ...item })));
  const [message, setMessage] = useState('');
  useEffect(() => { setBudget(String(trip.budget || '')); setCategories({ ...trip.categoryBudgets }); setExtras((trip.overlookedCosts?.length ? trip.overlookedCosts : DEMO_EXTRAS).map((item) => ({ ...item }))); setMessage(''); }, [trip.id]);
  const allocated = Object.values(categories).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const extraTotal = extras.filter((item) => item.checked).reduce((sum, item) => sum + (Number(item.estimate) || 0), 0);
  const budgetNumber = Number(budget) || 0;

  async function savePlan() {
    try {
      setMessage('');
      await onSave({ budget: budgetNumber, categoryBudgets: categories, overlookedCosts: extras });
      setMessage('Plan saved. Your numbers are up to date.');
    } catch (error) { setMessage(error.message); }
  }

  return <>
    <section className="intro"><span className="eyebrow">Make room for the good stuff</span><h1>Your plan</h1><p>A simple budget for {trip.destination}, with the little costs that add up.</p></section>
    <section className="plan-total"><div><span className="eyebrow">Trip budget</span><h2>{money(budgetNumber)}</h2><p>{money(summary.remaining)} currently available</p></div><button className="button outline small" onClick={onNewTrip}><Icon name="plus" size={17}/> New trip</button></section>
    <div className="section-heading"><div><span className="eyebrow">Set your limits</span><h2>Budget by category</h2></div></div>
    <section className="plan-card"><label className="field-label" htmlFor="total-budget">Total budget (USD)</label><div className="dollar-input"><span>$</span><input id="total-budget" type="number" min="1" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} /></div><div className="category-list">{PLAN_CATEGORIES.map((category) => <label className="category-budget" key={category}><span>{category === 'Transit' ? 'Getting around' : category === 'Food' ? 'Food & drinks' : category === 'Activities' ? 'Things to do' : category === 'Buffer' ? 'Just in case' : category}</span><div className="dollar-input compact"><span>$</span><input type="number" min="0" step="0.01" value={categories[category] ?? ''} onChange={(e) => setCategories((current) => ({ ...current, [category]: e.target.value }))} aria-label={`${category} budget`} /></div></label>)}</div><div className={`allocation ${allocated > budgetNumber ? 'over' : ''}`}><span>Allocated across categories</span><strong>{money(allocated)} / {money(budgetNumber)}</strong></div></section>
    <div className="section-heading"><div><span className="eyebrow">Easy to miss</span><h2>Extra trip costs</h2></div></div>
    <section className="plan-card"><p className="card-description">Check the costs you expect and adjust the estimates. They help you leave room in your plan.</p><div className="extra-list">{extras.map((item, index) => <div className="extra-row" key={item.id || index}><label><input type="checkbox" checked={Boolean(item.checked)} onChange={(e) => setExtras((current) => current.map((entry, i) => i === index ? { ...entry, checked: e.target.checked } : entry))}/><span>{item.label}</span></label><div className="dollar-input compact"><span>$</span><input type="number" min="0" step="0.01" aria-label={`${item.label} estimate`} value={item.estimate ?? 0} onChange={(e) => setExtras((current) => current.map((entry, i) => i === index ? { ...entry, estimate: e.target.value } : entry))}/></div></div>)}</div><div className="allocation"><span>Selected extra costs</span><strong>{money(extraTotal)}</strong></div><p className="field-help">These estimates are planning reminders; they do not count as expenses until you log them.</p></section>
    {message && <p className={`save-message ${message.startsWith('Plan saved') ? 'success' : ''}`} role="status">{message}</p>}
    <button className="button primary full plan-save" disabled={busy || budgetNumber <= 0} onClick={savePlan}>{busy ? 'Saving…' : 'Save plan'} <Icon name="arrow" size={18}/></button>
  </>;
}

function Expenses({ expenses, summary, onAdd, onEdit }) {
  const byCategory = CATEGORIES.map((category) => ({ category, total: expenses.filter((expense) => expense.category === category).reduce((sum, expense) => sum + Number(expense.amountBase || 0), 0) })).filter((row) => row.total > 0).sort((a, b) => b.total - a.total);
  return <><section className="intro"><span className="eyebrow">Every little thing</span><h1>Expenses</h1><p>See where your money is going, in one place.</p></section>
    <section className="expenses-total"><span className="eyebrow">Total spent</span><h2>{money(summary.spent)}</h2><p>{expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'} logged</p></section>
    <div className="section-heading"><div><span className="eyebrow">The breakdown</span><h2>By category</h2></div></div>
    <section className="category-summary">{byCategory.length ? byCategory.map((row) => <div key={row.category} className="summary-row"><span>{row.category}</span><div className="summary-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, (row.total / Math.max(summary.spent, 1)) * 100)}%` }}/></div><strong>{money(row.total)}</strong></div>) : <p className="empty-list">Categories appear after you add an expense.</p>}</section>
    <div className="section-heading"><div><span className="eyebrow">Your history</span><h2>All expenses</h2></div><button className="text-link" onClick={onAdd}><Icon name="plus" size={17}/> Add</button></div>
    <section className="list-card">{expenses.length ? expenses.map((expense) => <ExpenseRow key={expense.clientId || expense.id} expense={expense} onEdit={onEdit}/>) : <div className="empty-list">No expenses yet. Add your first purchase.</div>}</section>
  </>;
}

export default function App() {
  const [trips, setTrips] = useState(() => readSaved('trips', []));
  const [selectedId, setSelectedId] = useState(() => readSaved('selectedTripId', null));
  const [expensesByTrip, setExpensesByTrip] = useState(() => readSaved('expensesByTrip', {}));
  const [queue, setQueue] = useState(() => readSaved('expenseQueue', []));
  const [rates, setRates] = useState(() => readSaved('rates', DEFAULT_RATES));
  const [tab, setTab] = useState('today');
  const [expenseModal, setExpenseModal] = useState(null);
  const [tripModal, setTripModal] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [message, setMessage] = useState('');
  const syncing = useRef(false);

  const activeId = selectedId || trips[0]?.id;
  const trip = trips.find((item) => String(item.id) === String(activeId)) || trips[0];

  const refreshExpenses = useCallback(async (tripId) => {
    const rows = await api(`/api/trips/${tripId}/expenses`);
    setExpensesByTrip((current) => { const next = { ...current, [tripId]: rows }; save('expensesByTrip', next); return next; });
    return rows;
  }, []);

  const refreshTrips = useCallback(async () => {
    const rows = await api('/api/trips');
    setTrips(rows); save('trips', rows);
    return rows;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [tripRows, rateData] = await Promise.all([refreshTrips(), api('/api/rates')]);
      setRates(rateData); save('rates', rateData);
      const currentId = selectedId && tripRows.some((item) => String(item.id) === String(selectedId)) ? selectedId : tripRows[0]?.id;
      if (currentId) { setSelectedId(currentId); save('selectedTripId', currentId); await refreshExpenses(currentId); }
      setOnline(true);
      setMessage('');
    } catch {
      setOnline(false);
      if (!readSaved('trips', []).length) setMessage('We couldn’t connect to the CarryOn server. Start the app server, then reload.');
    }
  }, [refreshExpenses, refreshTrips, selectedId]);

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const onOnline = () => { setOnline(true); refresh(); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [refresh]);

  const syncQueue = useCallback(async () => {
    if (syncing.current || !navigator.onLine) return;
    const pending = readSaved('expenseQueue', []);
    if (!pending.length) return;
    syncing.current = true;
    try {
      for (const item of pending) {
        await api(`/api/trips/${item.tripId}/expenses`, { method: 'POST', body: JSON.stringify(item.payload) });
        const remaining = readSaved('expenseQueue', []).filter((entry) => entry.payload.clientId !== item.payload.clientId);
        save('expenseQueue', remaining); setQueue(remaining);
      }
      const currentId = readSaved('selectedTripId', null);
      if (currentId) await refreshExpenses(currentId);
      await refreshTrips();
      setMessage('Your expenses are synced.');
      setOnline(true);
    } catch {
      setOnline(false);
      setMessage('Saved on this device. Your expense will sync when you reconnect.');
    } finally { syncing.current = false; }
  }, [refreshExpenses, refreshTrips]);

  useEffect(() => { if (online && queue.length) syncQueue(); }, [online, queue.length, syncQueue]);
  useEffect(() => {
    if (!queue.length) return undefined;
    const timer = window.setInterval(() => { if (navigator.onLine) syncQueue(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [queue.length, syncQueue]);

  const expenses = useMemo(() => {
    if (!trip) return [];
    const savedRows = expensesByTrip[trip.id] || [];
    const savedIds = new Set(savedRows.map((row) => row.clientId));
    const pending = queue.filter((item) => String(item.tripId) === String(trip.id) && !savedIds.has(item.payload.clientId)).map((item) => {
      const rate = rates.rates?.[item.payload.currency] || 1;
      return { ...item.payload, id: `pending-${item.payload.clientId}`, tripId: item.tripId, amountBase: Number(item.payload.amount) / rate, rate, createdAt: item.queuedAt || '', pending: true };
    });
    return [...pending, ...savedRows].sort((a, b) => `${b.date}${b.createdAt || ''}`.localeCompare(`${a.date}${a.createdAt || ''}`));
  }, [trip, expensesByTrip, queue, rates]);

  const summary = useMemo(() => {
    const spent = expenses.reduce((sum, item) => sum + Number(item.amountBase || 0), 0);
    const budget = Number(trip?.budget || 0);
    return { spent, remaining: budget - spent, percentUsed: budget > 0 ? (spent / budget) * 100 : 0, count: expenses.length };
  }, [expenses, trip]);

  async function selectTrip(id) {
    setSelectedId(id); save('selectedTripId', id);
    try { await refreshExpenses(id); setOnline(true); } catch { setOnline(false); }
  }

  async function saveExpense(payload, original) {
    if (!trip) throw new Error('Select a trip first.');
    setBusy(true);
    try {
      if (original?.pending) {
        const next = queue.map((item) => item.payload.clientId === original.clientId ? { ...item, payload: { ...payload, clientId: original.clientId } } : item);
        setQueue(next); save('expenseQueue', next);
        if (navigator.onLine) syncQueue();
      } else if (original) {
        await api(`/api/expenses/${original.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        await refreshExpenses(trip.id); await refreshTrips();
      } else {
        const item = { tripId: trip.id, queuedAt: new Date().toISOString(), payload: { ...payload, clientId: crypto.randomUUID() } };
        const next = [...readSaved('expenseQueue', []), item];
        setQueue(next); save('expenseQueue', next);
        setMessage('Expense saved.');
        if (navigator.onLine) syncQueue();
      }
    } catch (error) { throw error; }
    finally { setBusy(false); }
  }

  async function savePlan(payload) {
    if (!trip) return;
    setBusy(true);
    try {
      const updated = await api(`/api/trips/${trip.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setTrips((current) => { const next = current.map((item) => String(item.id) === String(trip.id) ? updated : item); save('trips', next); return next; });
    } finally { setBusy(false); }
  }

  async function createTrip(payload) {
    setBusy(true);
    try {
      const created = await api('/api/trips', { method: 'POST', body: JSON.stringify(payload) });
      const rows = await refreshTrips();
      const id = created.id || rows[rows.length - 1]?.id;
      if (id) { setSelectedId(id); save('selectedTripId', id); await refreshExpenses(id); }
      setTab('plan');
    } finally { setBusy(false); }
  }

  if (!trip) return <div className="app-shell"><header className="site-header"><div className="brand"><PlaneIcon/><span>carryon<span className="brand-dot">.</span></span></div></header><main className="content"><section className="intro"><span className="eyebrow">Travel money, made clear</span><h1>Ready for takeoff?</h1><p>{message || 'Loading your trips…'}</p></section>{message && <button className="button primary" onClick={refresh}>Try again <Icon name="arrow" size={18}/></button>}</main></div>;

  return <div className="app-shell">
    <header className="site-header"><div className="header-inner"><div className="brand"><PlaneIcon/><span>carryon<span className="brand-dot">.</span></span></div><div className="header-actions"><label className="trip-select-label"><span className="sr-only">Current trip</span><select value={activeId} onChange={(e) => selectTrip(e.target.value)}>{trips.map((item) => <option value={item.id} key={item.id}>{item.destination}</option>)}</select></label><button className="icon-button bell" onClick={() => setAlertsOpen((open) => !open)} aria-label="Notifications"><Icon name="bell"/></button></div></div></header>
    {alertsOpen && <div className="alerts-panel" role="status"><strong>You’re all caught up.</strong><span>Trip alerts are planned for a later version.</span></div>}
    <main className="content">
      {!online && <div className="offline-banner" role="status"><span className="offline-dot"/>Offline mode · expenses save on this device</div>}
      {message && online && <div className="status-banner" role="status">{message}<button onClick={() => setMessage('')} aria-label="Dismiss message"><Icon name="close" size={15}/></button></div>}
      {tab === 'today' && <Today trip={trip} expenses={expenses} summary={summary} onAdd={() => setExpenseModal({ mode: 'new' })} onEdit={(expense) => setExpenseModal({ mode: 'edit', expense })} onViewExpenses={() => setTab('expenses')} rates={rates}/>}
      {tab === 'plan' && <Plan trip={trip} summary={summary} onSave={savePlan} onNewTrip={() => setTripModal(true)} busy={busy}/>}
      {tab === 'expenses' && <Expenses expenses={expenses} summary={summary} onAdd={() => setExpenseModal({ mode: 'new' })} onEdit={(expense) => setExpenseModal({ mode: 'edit', expense })}/>}
    </main>
    <nav className="bottom-nav" aria-label="Main navigation"><div className="nav-inner">{[['today','Today'],['plan','Plan'],['expenses','Expenses']].map(([key,label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)} aria-current={tab === key ? 'page' : undefined}><Icon name={key}/><span>{label}</span></button>)}</div></nav>
    {expenseModal && <ExpenseModal key={expenseModal.expense?.id || 'new'} trip={trip} rates={rates} expense={expenseModal.expense} onClose={() => setExpenseModal(null)} onSave={saveExpense} busy={busy}/>}
    {tripModal && <TripModal onClose={() => setTripModal(false)} onCreate={createTrip} busy={busy}/>}
  </div>;
}
