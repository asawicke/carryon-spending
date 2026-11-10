import React, { useState } from 'react';
import Modal from './Modal';
import { money } from '../lib';
export default function DeleteExpense({ expense, onDelete, onClose }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal title="Remove this expense?" onClose={onClose}><p>{expense.note || expense.category} · {money(expense.amount, expense.currency)}</p><p className="field-help">It will disappear from your expense list and your remaining budget will be recalculated.</p>{error && <p role="alert" className="form-error">{error}</p>}
    <div className="form-actions"><button className="button danger" data-initial-focus disabled={busy} onClick={async () => { setBusy(true); try { await onDelete(expense); onClose(); } catch (e) { setError(e.message); } finally { setBusy(false); } }}>{busy ? 'Removing…' : 'Remove expense'}</button><button className="button outline" disabled={busy} onClick={onClose}>Keep expense</button></div>
  </Modal>;
}
