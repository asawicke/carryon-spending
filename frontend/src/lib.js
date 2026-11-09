export const CATEGORIES = ['Stay', 'Transit', 'Flights', 'Food', 'Activities', 'Shopping', 'Other'];
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR', 'NZD'];
export const EMPTY_RATES = { base: 'USD', rates: { USD: 1 }, dates: {}, unavailable: true };
export const EXTRA_COSTS = ['Passport renewal', 'Visa or entry fees', 'Travel insurance', 'Airport transfer', 'SIM / eSIM', 'Foreign transaction fees', 'Baggage fees', 'Emergency cushion'].map((label, i) => ({ id: 'extra-' + i, label, checked: false, estimate: 0 }));
export const PREPARATION = [
  ['passport', 'Passport validity checked', 'Check the destination’s validity and blank-page rules.'],
  ['visa', 'Entry / visa requirements checked', 'Use the destination government’s official website for your nationality.'],
  ['insurance', 'Travel insurance reviewed', 'Check medical cover, exclusions, and your existing policy.'],
  ['sim', 'SIM / eSIM planned', 'Check phone compatibility and roaming costs.'],
  ['fees', 'Card and ATM fees checked', 'Ask your bank about foreign transaction and cash withdrawal fees.'],
  ['baggage', 'Baggage allowance checked', 'Confirm the allowance and extra charges with your airline.'],
];
export function readSaved(key, fallback) {
  try { return JSON.parse(localStorage.getItem('carryon:v2:' + key)) ?? fallback; } catch { return fallback; }
}
export function save(key, value) { localStorage.setItem('carryon:v2:' + key, JSON.stringify(value)); }
export function localDate() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
export function money(amount, currency = 'USD', digits = 2) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(amount) || 0);
}
export function shortDate(value) { return value ? new Date(value + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; }
export function dayNumber(value) { return value ? Date.parse(value + 'T00:00:00Z') / 86400000 : null; }
export function timing(trip, today = localDate()) {
  const start = dayNumber(trip.startDate), end = dayNumber(trip.endDate), now = dayNumber(today);
  if (start === null || end === null) return { total: 1, remaining: 1, phase: 'Add trip dates on Plan', active: false };
  const total = Math.max(1, end - start + 1);
  return { total, remaining: now > end ? 0 : now < start ? total : end - now + 1,
    phase: now < start ? (start - now) + ' days until departure' : now > end ? 'Trip completed' : 'Day ' + (now - start + 1) + ' of ' + total,
    active: now >= start && now <= end };
}
export function estimate(amount, currency, home, rates) {
  if (currency === home) return Number(amount);
  return rates.rates?.[currency] && rates.rates?.[home] ? Number(amount) * rates.rates[home] / rates.rates[currency] : null;
}
export function positiveAmount(value) { return /^(?:\d+(?:[.,]\d{1,2})?|[.,]\d{1,2})$/.test(String(value)) && Number(String(value).replace(',', '.')) > 0; }
export async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message || body.message || 'Something went wrong. Please try again.');
    error.status = response.status; throw error;
  }
  return body;
}
export function byCategory(expenses) {
  const totals = new Map();
  expenses.forEach((row) => totals.set(row.category, (totals.get(row.category) || 0) + Number(row.amountBase || 0)));
  return Array.from(totals, ([category, total]) => ({ category, total })).filter((row) => row.total > 0).sort((a, b) => b.total - a.total);
}
