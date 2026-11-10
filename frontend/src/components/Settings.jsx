import React, { useState } from 'react';
import Modal from './Modal';
import AccountForm from './AccountForm';
import { QuickGuide } from './GettingStarted';
export default function Settings({ theme, setTheme, account, data, onClose }) {
  const [removing, setRemoving] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function remove() { setBusy(true); setError(''); try { await data.deleteCategory(removing); setRemoving(''); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  return <Modal title="Settings" onClose={onClose}><div className="settings-stack">
    <section aria-labelledby="appearance-title"><h3 id="appearance-title">Appearance</h3><label className="field-label" htmlFor="theme-choice">Color theme</label><select className="text-input" id="theme-choice" data-initial-focus value={theme} onChange={(e) => setTheme(e.target.value)}><option value="system">Use device setting</option><option value="light">Light</option><option value="dark">Dark</option></select><p className="field-help">Your selection is remembered on this device. Labels and icons carry meaning alongside color.</p></section>
    <AccountForm account={account} onRefresh={data.refresh}/>
    <section aria-labelledby="categories-title"><h3 id="categories-title">Custom categories</h3><p className="field-help">Remove a category from future choices. Existing expenses and allocations keep their labels and amounts.</p>
      {data.categories.length ? <ul className="settings-categories">{data.categories.map((name) => <li key={name}><span>{name}</span><button className="button outline" onClick={() => { setRemoving(name); setError(''); }}>Remove <span className="sr-only">{name}</span></button></li>)}</ul> : <p className="field-help">No custom categories yet. Add one using Other when recording an expense.</p>}
      {removing && <div className="confirmation" role="group" aria-label="Confirm category removal"><p>Remove “{removing}” from future choices?</p><div className="form-actions"><button className="button danger" disabled={busy} onClick={remove}>Remove category</button><button className="button outline" disabled={busy} onClick={() => setRemoving('')}>Cancel</button></div></div>}{error && <p className="form-error" role="alert">{error}</p>}
    </section>
    <section aria-labelledby="services-title"><h3 id="services-title">Connection and services</h3><p>{data.online ? 'Connected to the local CarryOn server.' : 'Offline or local server unavailable.'}</p><p>Flight fare search: {data.services.fareSearch ? 'Ready' : 'Not configured or status unavailable'}.</p><p className="field-help">{data.services.message || 'Restart the local server to reload its .env configuration.'}</p><p className="field-help">Exchange rates: {data.rates.unavailable ? 'unavailable; home-currency entry works' : data.rates.stale ? 'cached reference rates' : 'Frankfurter reference rates'}. Saved expenses keep their conversion rate.</p></section>
    <details><summary>How CarryOn works</summary><QuickGuide/></details>
  </div></Modal>;
}
