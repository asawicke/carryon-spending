import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib';

let library;
function loadLibrary() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!library) library = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    const timer = setTimeout(() => { script.remove(); reject(new Error('Google sign-in did not load. Continue with email, or retry.')); }, 12000);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Google sign-in is unavailable. Continue with email, or retry.')); };
    document.head.append(script);
  }).catch((error) => { library = null; throw error; });
  return library;
}

export default function GoogleSignIn({ clientId, busy, onCredential }) {
  const container = useRef(null), callback = useRef(onCredential), busyRef = useRef(busy);
  const challenge = useRef(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(Boolean(clientId)), [retry, setRetry] = useState(0);
  callback.current = onCredential; busyRef.current = busy;
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setError(''); setLoading(true);
    challenge.current ||= api('/api/account/google/challenge');
    Promise.all([loadLibrary(), challenge.current]).then(([, { nonce }]) => {
      if (cancelled) return;
      window.google.accounts.id.initialize({ client_id: clientId, nonce, auto_select: false, ux_mode: 'popup', callback: ({ credential }) => { if (!cancelled && !busyRef.current) callback.current(credential); } });
      container.current.replaceChildren();
      window.google.accounts.id.renderButton(container.current, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', width: String(Math.min(400, container.current.clientWidth)), locale: 'en' });
      setLoading(false);
    }).catch((e) => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [clientId, retry]);
  if (!clientId) return <div className="google-unavailable"><button className="button outline full" disabled aria-describedby="google-setup">Continue with Google</button><p id="google-setup" className="field-help">Google sign-in needs setup. Email sign-in is available below.</p></div>;
  return <div className="google-signin"><div ref={container} inert={busy ? true : undefined}/>{loading && <p role="status" className="field-help">Loading Google sign-in…</p>}{error && <><p className="form-error" role="alert">{error}</p><button className="button outline" onClick={() => { challenge.current = null; setRetry(retry + 1); }}>Retry Google sign-in</button></>}</div>;
}
