import React, { useState } from 'react';
import Modal from './Modal';
import Icon from './Icons';
import { CATEGORIES, CURRENCIES, estimate, localDate, money, positiveAmount } from '../lib';
export default function ExpenseForm({ trip, rates, categories, expense, onClose, onSave }) {
  const choices = Array.from(new Set([...CATEGORIES, ...categories]));
  const [form, setForm] = useState({ amount: expense?.amount ?? '', currency: expense?.currency || trip.localCurrency,
    category: expense?.category || 'Food', note: expense?.note || '', date: expense?.date || localDate(), custom: '' });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const amount = Number(String(form.amount).replace(',', '.'));
  const home = estimate(amount, form.currency, trip.currency, rates);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event) {
    event.preventDefault(); setError('');
    if (!positiveAmount(form.amount)) { setError('Enter a positive amount with up to two decimal places.'); return; }
    if (home === null) { setError('No exchange rate is available. Try later or enter your actual home-currency charge.'); return; }
    const category = form.category === 'Other' ? form.custom.trim().replace(/\s+/g, ' ') : form.category;
    if (!category) { setError('Give your custom category a name.'); return; }
    setBusy(true);
    try { await onSave({ amount, currency: form.currency, category, note: form.note.trim(), date: form.date }, expense); onClose(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const rateDate = rates.dates?.[form.currency === 'USD' ? trip.currency : form.currency];
  return <Modal title={expense ? 'Edit expense' : 'Add an expense'} onClose={onClose}><form onSubmit={submit}>
    <label className="field-label" htmlFor="expense-amount">Amount</label>
    <div className="amount-field"><select aria-label="Expense currency" value={form.currency} onChange={(e) => update('currency', e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
      <input id="expense-amount" type="text" inputMode="decimal" required pattern="(?:[0-9]+(?:[.,][0-9]{1,2})?|[.,][0-9]{1,2})" maxLength="16" value={form.amount} onChange={(e) => update('amount', e.target.value)} placeholder="0.00" aria-describedby="conversion-help" data-initial-focus autoFocus /></div>
    <p id="conversion-help" className="field-help" aria-live="polite">{home === null ? 'Exchange rate unavailable. Choose your home currency or try again later.' : 'About ' + money(home, trip.currency) + ' in your home currency.'} {form.currency !== trip.currency && home !== null && <>Frankfurter reference rate{rateDate ? ' dated ' + rateDate : ''}{rates.stale ? ' (cached)' : ''}. Your bank may charge a different rate or fees.</>}</p>
    <label className="field-label" htmlFor="expense-note">What was it for? <span className="optional">(optional)</span></label>
    <input id="expense-note" className="text-input" maxLength="200" value={form.note} onChange={(e) => update('note', e.target.value)} placeholder="Coffee near the station" />
    <label className="field-label" htmlFor="expense-category">Category</label>
    <select id="expense-category" className="text-input" value={form.category} onChange={(e) => update('category', e.target.value)}>{choices.filter((c) => c !== 'Other').map((c) => <option key={c}>{c}</option>)}<option value="Other">Other — add a category</option></select>
    {form.category === 'Other' && <><label className="field-label" htmlFor="custom-category">Custom category name</label><input id="custom-category" className="text-input" value={form.custom} onChange={(e) => update('custom', e.target.value)} maxLength="40" required aria-describedby="custom-help"/><p id="custom-help" className="field-help">Saved categories will be available on future expenses. Names ignore capitalization.</p></>}
    <label className="field-label" htmlFor="expense-date">Date</label><input id="expense-date" className="text-input" type="date" required value={form.date} onChange={(e) => update('date', e.target.value)}/>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button primary full" disabled={busy}>{busy ? 'Saving…' : expense ? 'Save changes' : 'Save expense'} <Icon name="arrow"/></button>
  </form></Modal>;
}
