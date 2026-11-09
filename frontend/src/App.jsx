import React, { useEffect, useRef, useState } from 'react';
import Icon from './components/Icons';
import Today from './components/Today';
import Expenses from './components/Expenses';
import Plan from './components/Plan';
import TripForm from './components/TripForm';
import ExpenseForm from './components/ExpenseForm';
import useCarryOn from './hooks/useCarryOn';
import { timing } from './lib';

export default function App() {
  const data = useCarryOn();
  const [tab, setTab] = useState(() => ['today', 'expenses', 'plan'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today');
  const [newTrip, setNewTrip] = useState(false), [expenseModal, setExpenseModal] = useState(null);
  const [statusOpen, setStatusOpen] = useState(false);
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
  const showNew = !data.loading && (!data.trip || newTrip) && (tab === 'plan' || !data.trip);
  const section = !data.trip ? 'plan' : tab;
  const activeTab = showNew ? 'plan' : tab;
  return <div className={'app-shell section-' + section}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <a className="brand" href="#today" aria-label="CarryOn home" onClick={() => { setNewTrip(false); navigate('today'); }}><Icon name="plane" size={24}/><span>carryon<span className="brand-dot">.</span></span></a>
      <div className="header-actions"><label className="trip-select-label"><span className="sr-only">Current trip</span><select value={showNew ? '__new' : data.trip?.id || '__new'} onChange={(e) => { if (e.target.value === '__new') openNewTrip(); else { setNewTrip(false); data.selectTrip(e.target.value); } }}>
        {data.trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.destination}</option>)}<option value="__new">+ New trip</option>
      </select></label><button className="icon-button" aria-label="Connection information" aria-expanded={statusOpen} aria-controls="connection-panel" onClick={() => setStatusOpen(!statusOpen)}><Icon name="bell"/></button></div></div></header>
    {statusOpen && <div className="alerts-panel" id="connection-panel"><strong>{data.online ? 'Connected to CarryOn' : 'Offline or server unavailable'}</strong><span>Saved expenses and trips remain on this device. Flight status is a snapshot checked when you request a lookup.</span><button className="button outline" onClick={() => setStatusOpen(false)}>Close</button></div>}
    <main className="content" id="main-content" ref={headingRef} tabIndex="-1">
      {!data.online && <div className="offline-banner" role="status">Offline or server unavailable · new expenses stay on this device</div>}
      {data.message && <div className="status-banner" role="status"><span>{data.message}</span><button className="icon-button" onClick={() => data.setMessage('')} aria-label="Dismiss message"><Icon name="close" size={16}/></button></div>}
      {data.rates.unavailable && data.trip && <p className="rate-note">Exchange-rate service unavailable. Home-currency expenses still work.</p>}
      {data.rates.stale && <p className="rate-note">Using cached exchange rates. Check the rate date before recording a foreign-currency expense.</p>}
      {data.loading && !data.trip ? <section className="intro" role="status"><h1>Loading your trips…</h1></section> : showNew ?
        <TripForm onCreate={async (payload) => { await data.createTrip(payload); setNewTrip(false); navigate('plan'); }} onCancel={data.trip ? () => setNewTrip(false) : undefined}/> :
        data.trip && <>
          {tab === 'today' && <Today {...data} onAdd={() => setExpenseModal({})} onEdit={setExpenseModal} onViewExpenses={() => navigate('expenses')}/>}
          {tab === 'expenses' && <Expenses {...data} onAdd={() => setExpenseModal({})} onEdit={setExpenseModal} onPlan={() => { setNewTrip(false); navigate('plan'); }}/>}
          {tab === 'plan' && <Plan key={data.trip.id} {...data} onSave={data.savePlan} onNewTrip={openNewTrip} onRefresh={data.refresh}/>}
        </>}
      {data.trip && <p className="sr-only">Selected trip: {data.trip.name}. {timing(data.trip).phase}.</p>}
    </main>
    <nav className="bottom-nav" aria-label="Main navigation"><div className="nav-inner">{[['today', 'Today', 'today'], ['expenses', 'Expenses', 'expenses'], ['plan', 'Plan', 'edit']].map(([id, label, icon]) => <button key={id} className={(activeTab === id ? 'active ' : '') + 'nav-' + id} onClick={() => { setNewTrip(false); navigate(id); }} aria-current={activeTab === id ? 'page' : undefined}><Icon name={icon}/><span>{label}</span></button>)}</div></nav>
    {expenseModal && data.trip && <ExpenseForm trip={data.trip} categories={data.categories} rates={data.rates} expense={expenseModal.id ? expenseModal : undefined} onSave={data.saveExpense} onClose={() => setExpenseModal(null)}/>}
  </div>;
}
