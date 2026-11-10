import React from 'react';
export function QuickGuide() {
  return <ol className="quick-guide"><li><strong>Plan before you go</strong><p>Add your destinations, dates and budget. Enter fixed costs first, then use an editable category suggestion.</p></li>
    <li><strong>Record what you spend</strong><p>Choose the destination and currency on the receipt. CarryOn shows an estimated home-currency equivalent.</p></li>
    <li><strong>Check your daily spending money</strong><p>Today keeps daily purchases separate from fixed costs and your emergency reserve. Compare a possible purchase before buying.</p></li></ol>;
}
export default function GettingStarted({ onCreate, onAccount, canImportDevice }) {
  return <section className="welcome"><span className="eyebrow">Your first trip, with a clearer plan</span><h1>Welcome to CarryOn</h1><p className="welcome-copy">A little planning before departure. A clear view of your spending while you’re away.</p>
    <QuickGuide/><div className="form-actions"><button className="button primary" onClick={onCreate}>Create your first trip</button><button className="button outline" onClick={onAccount}>{canImportDevice ? 'Account and saved device trips' : 'Account settings'}</button></div><p className="field-help">{canImportDevice ? 'Already used CarryOn on this server? Open Account and saved device trips to move your earlier trips into your account.' : 'Your trips are saved to your account. Sign in on another device to see entries after they sync.'}</p>
  </section>;
}
