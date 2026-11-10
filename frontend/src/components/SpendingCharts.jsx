import React from 'react';
import { byCategory, money } from '../lib';
// Dark variants of the Okabe–Ito hues; labels/percentages carry the meaning too.
export const CHART_COLORS = Array.from({ length: 6 }, (_, index) => 'var(--chart-' + (index + 1) + ')');
export function chartGroups(expenses) {
  const rows = byCategory(expenses), total = rows.reduce((s, r) => s + r.total, 0);
  const large = [], small = [];
  rows.forEach((row) => (row.category !== 'Other' && row.total / total >= .03 && large.length < 5 ? large : small).push(row));
  if (small.length) large.push({ category: 'Other', total: small.reduce((s, r) => s + r.total, 0), members: small.map((r) => r.category) });
  return { rows: large, total };
}
export default function SpendingCharts({ expenses, currency }) {
  const { rows, total } = chartGroups(expenses);
  let offset = 0;
  if (!rows.length) return <p className="empty-list">Add an expense to see your spending distribution.</p>;
  return <div className="chart-grid">
    <section className="category-summary" aria-labelledby="bar-title"><h3 id="bar-title">Category totals</h3>{rows.map((row, index) => <div className="summary-row" key={row.category}><span>{index + 1}. {row.category}</span><div className="summary-bar" aria-hidden="true"><i style={{ width: (row.total / total * 100) + '%', background: CHART_COLORS[index] }}/></div><strong>{money(row.total, currency)}</strong></div>)}</section>
    <figure className="donut-card"><figcaption>Share of total spending</figcaption>
      <svg viewBox="0 0 140 140" className="category-donut" role="img" aria-labelledby="donut-title donut-desc"><title id="donut-title">Spending by category</title><desc id="donut-desc">Category amounts and percentages are listed immediately below this chart.</desc>{rows.map((row, index) => {
        const percent = row.total / total * 100, gap = Math.min(.5, percent * .1), start = offset; offset += percent;
        return <circle key={row.category} cx="70" cy="70" r="48" fill="none" pathLength="100" stroke={CHART_COLORS[index]} strokeWidth="21" strokeDasharray={(percent - gap) + ' ' + (100 - percent + gap)} strokeDashoffset={-start} transform="rotate(-90 70 70)"/>;
      })}<text x="70" y="72" textAnchor="middle" className="donut-total">100%</text><text x="70" y="88" textAnchor="middle" className="donut-caption">of logged spending</text></svg>
      <ol className="chart-legend">{rows.map((row, i) => <li key={row.category}><span className="legend-swatch" style={{ background: CHART_COLORS[i] }} aria-hidden="true"/><span>{i + 1}. {row.category}</span><strong>{(row.total / total * 100).toFixed(1)}%</strong></li>)}</ol>
      {rows.some((r) => r.members) && <details><summary>What’s grouped in Other?</summary><p>Categories below 3% and categories beyond the five largest are combined: {rows.find((r) => r.members).members.join(', ')}. Their individual amounts remain in your expense history and category budgets.</p></details>}
    </figure>
  </div>;
}
