import React, { useState } from 'react';
import Icon from './Icons';
import GoogleSignIn from './GoogleSignIn';

export default function AuthPage({ account, appearance }) {
  const [mode, setMode] = useState('login'), [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [showPassword, setShowPassword] = useState(false);
  async function authenticate(method, payload) {
    setBusy(true); setError('');
    try { await account.authenticate(method, payload); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); setForm((previous) => ({ ...previous, password: '' })); }
  }
  function changeMode() { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setForm({ ...form, password: '' }); }
  const register = mode === 'register';
  return <main className="auth-page" id="main-content">
    <div className="auth-appearance"><label className="sr-only" htmlFor="auth-theme">Color theme</label><select id="auth-theme" className="text-input" value={appearance.theme} onChange={(e) => appearance.setTheme(e.target.value)}><option value="system">Device theme</option><option value="light">Light mode</option><option value="dark">Dark mode</option></select></div>
    <section className="auth-card" aria-labelledby="auth-title">
      <a className="brand auth-brand" href="#today" aria-label="CarryOn home"><Icon name="plane" size={27}/><span>carryon<span className="brand-dot">.</span></span></a>
      <h1 id="auth-title">{register ? 'Create your account' : 'Welcome back'}</h1>
      <p className="auth-intro">{register ? 'A clearer plan for your next adventure.' : 'Sign in to plan your trip and track your spending.'}</p>
      {!account.ready ? <p role="status">Checking your sign-in…</p> : <>
        <GoogleSignIn clientId={account.googleClientId} busy={busy} onCredential={(credential) => authenticate('google', { credential })}/>
        <div className="auth-divider"><span>or continue with email</span></div>
      </>}
      <form onSubmit={(event) => { event.preventDefault(); authenticate(mode, register ? form : { email: form.email, password: form.password }); }} aria-label={register ? 'Create account' : 'Sign in'}>
        <fieldset disabled={busy || !account.ready} className="auth-fields">
          {register && <><label htmlFor="signin-name">Your name</label><input id="signin-name" className="text-input" autoComplete="name" required maxLength="60" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></>}
          <label htmlFor="signin-email">Email address</label><input id="signin-email" className="text-input" type="email" autoComplete="username" required maxLength="254" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}/>
          <label htmlFor="signin-password">Password</label>
          <div className="auth-password"><input id="signin-password" className="text-input" type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 12 : undefined} maxLength="256" aria-describedby={register ? 'password-help' : undefined} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}/><button type="button" className="auth-reveal" aria-controls="signin-password" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}<span className="sr-only"> password</span></button></div>
          {register && <p className="field-help" id="password-help">Use at least 12 characters. A memorable passphrase works well.</p>}
          <button className="button primary full auth-submit">{busy ? 'Signing you in…' : register ? 'Create account' : 'Continue'}</button>
        </fieldset>
      </form>
      {(error || account.error) && <p role="alert" className="form-error">{error || account.error}</p>}
      {account.error && <button className="button outline full" disabled={busy} onClick={account.retry}>Retry connection</button>}
      <p className="auth-switch">{register ? 'Already have an account?' : 'Don’t have an account?'} <button type="button" disabled={busy || !account.ready} onClick={changeMode}>{register ? 'Sign in' : 'Create account'}</button></p>
      <p className="auth-footnote">Accounts and trips are saved on this CarryOn server. Email verification and password reset are not available yet.</p>
    </section>
  </main>;
}
