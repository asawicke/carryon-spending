import React, { useEffect, useRef } from 'react';
import Icon from './Icons';
export default function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current, previous = document.activeElement;
    dialog.showModal();
    dialog.querySelector('[data-initial-focus]')?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  function containFocus(event) {
    if (event.key !== 'Tab') return;
    const controls = Array.from(ref.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]')).filter((el) => el.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <dialog ref={ref} className="modal" aria-labelledby="modal-title" onKeyDown={containFocus} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="modal-head"><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close form"><Icon name="close"/></button></div>
    {children}
  </dialog>;
}
