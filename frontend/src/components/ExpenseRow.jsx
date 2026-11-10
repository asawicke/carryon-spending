import React from 'react';
import Icon from './Icons';
import { money, shortDate } from '../lib';
export default function ExpenseRow({ expense, homeCurrency, onEdit, onDelete }) {
  return <div className="expense-row"><div className="expense-mark" aria-hidden="true">{expense.category.slice(0, 1)}</div>
    <div className="expense-main"><strong>{expense.note || expense.category}</strong><span>{expense.category} · {shortDate(expense.date)}{expense.pending ? ' · Waiting to sync' : ''}</span></div>
    <div className="expense-amount"><strong>{money(expense.amountBase, homeCurrency)}</strong><span>{expense.currency !== homeCurrency ? money(expense.amount, expense.currency) : homeCurrency}</span></div>
    <div className="expense-actions"><button className="icon-button row-edit" onClick={() => onEdit(expense)} aria-label={'Edit ' + (expense.note || expense.category)}><Icon name="edit" size={16}/></button>
    {onDelete && <button className="icon-button row-delete" onClick={() => onDelete(expense)} aria-label={'Remove ' + (expense.note || expense.category)}><Icon name="trash" size={17}/></button>}</div>
  </div>;
}
