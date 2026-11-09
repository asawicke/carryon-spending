import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, EMPTY_RATES, estimate, readSaved, save } from '../lib';

export default function useCarryOn() {
  const [trips, setTrips] = useState(() => readSaved('trips', []));
  const [selectedId, setSelectedId] = useState(() => readSaved('selected', ''));
  const [expensesByTrip, setExpensesByTrip] = useState(() => readSaved('expenses', {}));
  const [queue, setQueue] = useState(() => readSaved('queue', []));
  const [rates, setRates] = useState(() => readSaved('rates', EMPTY_RATES));
  const [categories, setCategories] = useState(() => readSaved('categories', []));
  const [online, setOnline] = useState(navigator.onLine), [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const syncing = useRef(false);
  const trip = trips.find((row) => row.id === selectedId) || trips[0];
  const refreshExpenses = useCallback(async (id) => {
    const rows = await api('/api/trips/' + id + '/expenses');
    setExpensesByTrip((current) => { const next = { ...current, [id]: rows }; save('expenses', next); return next; });
    return rows;
  }, []);
  const refresh = useCallback(async () => {
    try {
      const [rows, fx, cats] = await Promise.all([api('/api/trips'), api('/api/rates'), api('/api/categories')]);
      setTrips(rows); save('trips', rows); setRates(fx); save('rates', fx); setCategories(cats.custom); save('categories', cats.custom);
      const id = readSaved('selected', '');
      const active = rows.find((row) => row.id === id)?.id || rows[0]?.id;
      if (active) { setSelectedId(active); save('selected', active); await refreshExpenses(active); }
      setOnline(true);
    } catch (error) { setOnline(false); setMessage('Could not reach the server. Saved information is available on this device.'); }
    finally { setLoading(false); }
  }, [refreshExpenses]);
  const syncQueue = useCallback(async () => {
    if (syncing.current || !navigator.onLine) return;
    const pending = readSaved('queue', []);
    if (!pending.length) return;
    syncing.current = true;
    const done = [];
    try {
      for (const item of pending) {
        await api('/api/trips/' + item.tripId + '/expenses', { method: 'POST', body: JSON.stringify(item.payload) });
        done.push(item.payload.clientId);
      }
      setMessage('Expenses saved and synced.');
    } catch (error) {
      setMessage(error.status && error.status < 500 ? 'An expense needs attention: ' + error.message + ' Open it to edit.' : 'Saved on this device. Sync will retry when the server is available.');
    } finally {
      await refresh();
      const remaining = readSaved('queue', []).filter((item) => !done.includes(item.payload.clientId));
      save('queue', remaining); setQueue(remaining); syncing.current = false;
    }
  }, [refresh]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const connected = () => { setOnline(true); refresh(); syncQueue(); };
    const disconnected = () => setOnline(false);
    window.addEventListener('online', connected); window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, [refresh, syncQueue]);
  useEffect(() => {
    syncQueue();
    const timer = setInterval(syncQueue, 30000);
    return () => clearInterval(timer);
  }, [syncQueue]);
  const expenses = useMemo(() => {
    if (!trip) return [];
    const saved = expensesByTrip[trip.id] || [], ids = new Set(saved.map((row) => row.clientId));
    const pending = queue.filter((row) => row.tripId === trip.id && !ids.has(row.payload.clientId)).map((row) => ({
      ...row.payload, id: 'pending-' + row.payload.clientId, amountBase: row.amountBase,
      pending: true, createdAt: row.createdAt,
    }));
    return [...pending, ...saved];
  }, [trip, expensesByTrip, queue]);
  const summary = useMemo(() => {
    const spent = expenses.reduce((s, row) => s + Number(row.amountBase), 0), budget = Number(trip?.budget || 0);
    return { spent, remaining: budget - spent, percentUsed: budget ? spent / budget * 100 : 0 };
  }, [expenses, trip]);
  async function selectTrip(id) {
    setSelectedId(id); save('selected', id);
    try { await refreshExpenses(id); } catch { setMessage('Showing the last saved expenses for this trip.'); }
  }
  async function saveExpense(payload, original) {
    if (original && !original.pending) {
      await api('/api/expenses/' + original.id, { method: 'PATCH', body: JSON.stringify(payload) });
      await refresh(); setMessage('Expense updated.'); return;
    }
    const amountBase = estimate(payload.amount, payload.currency, trip.currency, rates);
    if (amountBase === null) throw new Error('An exchange rate is unavailable for this currency.');
    const clientId = original?.clientId || crypto.randomUUID();
    const next = readSaved('queue', []).filter((row) => row.payload.clientId !== clientId);
    next.push({ tripId: trip.id, payload: { ...payload, clientId }, amountBase, createdAt: new Date().toISOString() });
    save('queue', next); setQueue(next);
    setCategories((current) => Array.from(new Set([...current, payload.category])));
    setMessage('Expense saved on this device. Foreign-currency estimates may change when synced.');
    await syncQueue();
  }
  async function savePlan(payload) {
    const updated = await api('/api/trips/' + trip.id, { method: 'PATCH', body: JSON.stringify(payload) });
    setTrips((rows) => { const next = rows.map((row) => row.id === updated.id ? updated : row); save('trips', next); return next; });
  }
  async function createTrip(payload) {
    const created = await api('/api/trips', { method: 'POST', body: JSON.stringify(payload) });
    save('selected', created.id); setSelectedId(created.id); await refresh(); return created;
  }
  const categoryChoices = Array.from(new Set([...categories, ...queue.map((item) => item.payload.category)]));
  return { trips, trip, expenses, summary, categories: categoryChoices, rates, online, loading, message, setMessage,
    selectTrip, saveExpense, savePlan, createTrip, refresh };
}
