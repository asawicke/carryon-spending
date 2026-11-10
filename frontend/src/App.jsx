import React, { useEffect, useRef, useState } from 'react';
import Icon from './components/Icons';
import Today from './components/Today';
import Expenses from './components/Expenses';
import Plan from './components/Plan';
import TripForm from './components/TripForm';
import ExpenseForm from './components/ExpenseForm';
import DeleteExpense from './components/DeleteExpense';
import GettingStarted from './components/GettingStarted';
import Settings from './components/Settings';
import AuthPage from './components/AuthPage';
import useCarryOn from './hooks/useCarryOn';
import useAccount from './hooks/useAccount';
import useTheme from './hooks/useTheme';
import { timing, setStorageScope } from './lib';

export default function App() {
  const account = useAccount(), appearance = useTheme();
  if (!account.ready || !account.user) return <AuthPage account={account} appearance={appearance}/>;
  const scope = account.user.id;
  setStorageScope(scope);
  return <Workspace key={scope} scope={scope} account={account} appearance={appearance}/>;
}
function Workspace({ scope, account, appearance }) {
  const data = useCarryOn(scope);
  const [tab, setTab] = useState(() => ['today', 'expenses', 'plan'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today');
  const [newTrip, setNewTrip] = useState(false), [expenseModal, setExpenseModal] = useState(null), [removing, setRemoving] = useState(null);
  const [settings, setSettings] = useState(false);
  const headingRef = useRef(null), first = useRef(true);
  function navigate(next) { setTab(next); location.hash = next; window.scrollTo({ top: 0 }); }
  function openNewTrip() { setNewTrip(true); navigate('plan'); }
  useEffect(() => {
    const changed = () => { const next = location.hash.slice(1); if (['today', 'expenses', 'plan'].includes(next)) setTab(next); };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const heading = headingRef.current?.querySelector('h1');
    heading?.setAttribute('tabindex', '-1'); heading?.focus();
  }, [tab, newTrip, data.trip?.id]);
  const showNew = newTrip && !data.loading;
  const section = showNew || !data.trip ? 'plan' : tab;
  return <div className={'app-shell section-' + section}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <a className="brand" href="#today" aria-label="CarryOn home" onClick={() => { setNewTrip(false); navigate('today'); }}><Icon name="plane" size={24}/><span>carryon<span className="brand-dot">.</span></span></a>
      <div className="header-actions">{data.trips.length > 0 && <label className="trip-select-label"><span className="sr-only">Current trip</span><select value={showNew ? '__new' : data.trip?.id || '__new'} onChange={(e) => { if (e.target.value === '__new') openNewTrip(); else { setNewTrip(false); data.selectTrip(e.target.value); } }}>
        {data.trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.destination}</option>)}<option value="__new">+ New trip</option>
      </select></label>}<button className="icon-button" aria-label="Settings and appearance" onClick={() => setSettings(true)}><Icon name="settings"/></button></div></div></header>
    <main className="content" id="main-content" ref={headingRef} tabIndex="-1">
      {!data.online && <div className="offline-banner" role="status">Offline or server unavailable · new expenses stay on this device</div>}
      {data.message && <div className="status-banner" role="status"><span>{data.message}</span><button className="icon-button" onClick={() => data.setMessage('')} aria-label="Dismiss message"><Icon name="close" size={16}/></button></div>}
      {data.rates.unavailable && data.trip && <p className="rate-note">Exchange-rate service unavailable. Home-currency expenses still work.</p>}
      {data.rates.stale && <p className="rate-note">Using cached exchange rates. Check the rate date before recording a foreign-currency expense.</p>}
      {data.loading && !data.trip ? <section className="intro" role="status"><h1>Getting your trip ready</h1><p>Checking saved trips on this server…</p></section> : showNew ?
        <TripForm onCreate={async (payload) => { await data.createTrip(payload); setNewTrip(false); navigate('plan'); }} onCancel={() => setNewTrip(false)}/> :
        !data.trip ? data.loadError ? <section className="intro"><h1>Let’s reconnect</h1><p>{data.loadError}</p><button className="button primary" onClick={data.refresh}>Retry connection</button></section> : <GettingStarted canImportDevice={account.canImportDevice} onCreate={openNewTrip} onAccount={() => setSettings(true)}/> : <>
          {tab === 'today' && <Today {...data} userName={account.user.name} onAdd={() => setExpenseModal({})} onEdit={setExpenseModal} onViewExpenses={() => navigate('expenses')}/>}
          {tab === 'expenses' && <Expenses {...data} onAdd={() => setExpenseModal({})} onEdit={setExpenseModal} onDelete={setRemoving} onPlan={() => { setNewTrip(false); navigate('plan'); }}/>}
          {tab === 'plan' && <Plan key={data.trip.id} {...data} onSave={data.savePlan} onNewTrip={openNewTrip} onRefresh={data.refresh}/>}
        </>}
      {data.trip && <p className="sr-only">Selected trip: {data.trip.name}. {timing(data.trip).phase}.</p>}
    </main>
    <nav className="bottom-nav" aria-label="Main navigation"><div className="nav-inner">{[['today', 'Today', 'today'], ['expenses', 'Expenses', 'expenses'], ['plan', 'Plan', 'edit']].map(([id, label, icon]) => <button key={id} className={((showNew ? 'plan' : tab) === id ? 'active ' : '') + 'nav-' + id} onClick={() => { setNewTrip(false); navigate(id); }} aria-current={(showNew ? 'plan' : tab) === id ? 'page' : undefined}><Icon name={icon}/><span>{label}</span></button>)}</div></nav>
    {settings && <Settings {...appearance} account={account} data={data} onClose={() => setSettings(false)}/>}
    {expenseModal && data.trip && <ExpenseForm trip={data.trip} categories={data.categories} rates={data.rates} expense={expenseModal.id ? expenseModal : undefined} onSave={data.saveExpense} onClose={() => setExpenseModal(null)}/>}
    {removing && <DeleteExpense expense={removing} onDelete={data.deleteExpense} onClose={() => setRemoving(null)}/>}
  </div>;
}
