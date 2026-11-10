import React from 'react';
import { CURRENCY_CATALOG } from '../lib';
export default function CurrencySelect(props) {
  return <select className="text-input" {...props}>{CURRENCY_CATALOG.map(({ code, name }) => <option value={code} key={code}>{code} — {name}</option>)}</select>;
}
