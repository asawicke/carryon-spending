export const CATEGORIES = ['Stay', 'Transit', 'Flights', 'Food', 'Activities', 'Shopping', 'Other'];
import currencyCatalog from './data/currencies.json';
export const CURRENCY_CATALOG = currencyCatalog;
export const CURRENCIES = currencyCatalog.map((row) => row.code);
export const EMPTY_RATES = { base: 'USD', rates: { USD: 1 }, dates: {}, unavailable: true };
export const EXTRA_COSTS = ['Passport renewal', 'Visa or entry fees', 'Travel insurance', 'Airport transfer', 'SIM / eSIM', 'Foreign transaction fees', 'Baggage fees'].map((label, i) => ({ id: 'extra-' + i, label, checked: false, estimate: 0 }));
export const PREPARATION = [
  ['passport', 'Passport validity checked', 'Check the destination’s validity and blank-page rules.'],
  ['visa', 'Entry / visa requirements checked', 'Use the destination government’s official website for your nationality.'],
  ['insurance', 'Travel insurance reviewed', 'Check medical cover, exclusions, and your existing policy.'],
  ['sim', 'SIM / eSIM planned', 'Check phone compatibility and roaming costs.'],
  ['fees', 'Card and ATM fees checked', 'Ask your bank about foreign transaction and cash withdrawal fees.'],
  ['baggage', 'Baggage allowance checked', 'Confirm the allowance and extra charges with your airline.'],
];
let storageScope = 'device';
export function setStorageScope(scope) { storageScope = scope; }
export function readSaved(key, fallback, scope = storageScope) {
  try { return JSON.parse(localStorage.getItem('carryon:v3:' + scope + ':' + key)) ?? (scope === 'device' ? JSON.parse(localStorage.getItem('carryon:v2:' + key)) : null) ?? fallback; } catch { return fallback; }
}
export function save(key, value, scope = storageScope) { localStorage.setItem('carryon:v3:' + scope + ':' + key, JSON.stringify(value)); }
export { localDate, shortDate, dayNumber, timing } from './time.js';
export function money(amount, currency = 'USD', digits = 2) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(amount) || 0);
}
export function estimate(amount, currency, home, rates) {
  if (currency === home) return Number(amount);
  return rates.rates?.[currency] && rates.rates?.[home] ? Number(amount) * rates.rates[home] / rates.rates[currency] : null;
}
export function positiveAmount(value) { return /^(?:\d+(?:[.,]\d{1,2})?|[.,]\d{1,2})$/.test(String(value)) && Number(String(value).replace(',', '.')) > 0; }
export async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), /fare-search|fare-booking/.test(path) ? 70000 : 12000);
  let response;
  try { response = await fetch(path, { ...options, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...options.headers } }); }
  catch (error) { throw new Error(error.name === 'AbortError' ? 'The request took too long. Try again; your saved data is safe.' : 'Cannot reach CarryOn. Check your connection and that the local server is running.'); }
  finally { clearTimeout(timer); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && !/^\/api\/account(?:\/|$)/.test(path)) window.dispatchEvent(new Event('carryon:signin-required'));
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
