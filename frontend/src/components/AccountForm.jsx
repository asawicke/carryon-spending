import React, { useState } from 'react';
import { api, readSaved } from '../lib';
export default function AccountForm({ account, onRefresh }) {
  const [mode, setMode] = useState('login'), [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  async function run(action) { setBusy(true); setError(''); setMessage(''); try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function submit(event) {
    event.preventDefault(); await run(() => account.authenticate(mode, mode === 'register' ? form : { email: form.email, password: form.password }));
    setForm((previous) => ({ ...previous, password: '' }));
  }
  return <section aria-labelledby="account-title"><h3 id="account-title">Your account</h3>
    {account.user ? <><p>Signed in as <strong>{account.user.name}</strong><br/>{account.user.email}</p>
      <button className="button outline" disabled={busy} onClick={() => run(account.logout)}>Sign out</button>
      {account.canImportDevice && <details><summary>Move existing device trips into this account</summary><p className="field-help">This moves trips created without an account on this server into your account. They will no longer appear in the shared device trip list.</p>
        <label className="check-option"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)}/>I want to move the existing device trips into my account.</label>
        <button className="button outline" disabled={busy || !confirm} onClick={() => run(async () => {
          const pending = readSaved('queue', [], 'device');
          const result = await api('/api/account/import-device', { method: 'POST', body: '{"confirm":true}' });
          // Stable client IDs make retries safe if only some offline entries reach the server.
          // Keep the original queue until every entry is acknowledged.
          for (const item of pending) await api('/api/trips/' + item.tripId + '/expenses', { method: 'POST', body: JSON.stringify(item.payload) });
          const keys = Object.keys(localStorage).filter((key) => key.startsWith('carryon:v3:device:') || key.startsWith('carryon:v2:'));
          keys.forEach((key) => localStorage.removeItem(key)); localStorage.setItem('carryon:device-data-moved', String(Date.now()));
          await onRefresh(); setMessage(result.message); setConfirm(false);
        })}>Move trips</button></details>}
    </> : <><p className="field-help">Accounts separate trips on this server. This prototype has no email verification, password reset or cloud sync; keep your password somewhere safe.</p>
      <div className="segmented" role="group" aria-label="Account action">{[['login', 'Sign in'], ['register', 'Create account']].map(([id, label]) => <button key={id} className="button outline" aria-pressed={mode === id} onClick={() => { setMode(id); setError(''); }}>{label}</button>)}</div>
      <form onSubmit={submit}><fieldset disabled={busy} className="fare-fields">
        {mode === 'register' && <><label className="field-label" htmlFor="account-name">Your name</label><input className="text-input" id="account-name" autoComplete="name" required maxLength="60" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></>}
        <label className="field-label" htmlFor="account-email">Email</label><input className="text-input" id="account-email" type="email" autoComplete="username" required maxLength="254" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}/>
        <label className="field-label" htmlFor="account-password">Password{mode === 'register' ? ' (at least 12 characters)' : ''}</label><input className="text-input" id="account-password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 12 : undefined} maxLength="256" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}/>
        <button className="button primary full">{busy ? 'Working…' : mode === 'register' ? 'Create account' : 'Sign in'}</button>
      </fieldset></form></>}
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status" className="save-message success">{message}</p>}
  </section>;
}
