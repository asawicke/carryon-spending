import { useEffect, useState } from 'react';
import { api, readSaved } from '../lib';

export default function useAccount() {
  const [user, setUser] = useState(null), [ready, setReady] = useState(false), [error, setError] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [canImportDevice, setCanImportDevice] = useState(false);
  async function load() {
    setError('');
    try { const response = await api('/api/account'); setUser(response.user); setGoogleClientId(response.googleClientId || ''); setCanImportDevice(Boolean(response.canImportDevice)); localStorage.setItem('carryon:last-account', JSON.stringify(response.user)); }
    catch (e) { setError(e.message); }
    finally { setReady(true); }
  }
  useEffect(() => {
    load();
    const expired = () => { setUser(null); localStorage.setItem('carryon:last-account', 'null'); setError('Your session ended. Sign in again; your saved trips are safe.'); };
    const switched = (event) => { if (event.key === 'carryon:last-account') load(); };
    window.addEventListener('carryon:signin-required', expired); window.addEventListener('storage', switched);
    return () => { window.removeEventListener('carryon:signin-required', expired); window.removeEventListener('storage', switched); };
  }, []);
  async function authenticate(mode, payload) {
    if (user && readSaved('queue', [], user.id).length) throw new Error('Sync pending expenses before switching accounts. Your entries are safe on this device.');
    const response = await api('/api/account/' + mode, { method: 'POST', body: JSON.stringify(payload) });
    localStorage.setItem('carryon:last-account', JSON.stringify(response.user)); setError(''); setUser(response.user);
  }
  async function logout() {
    if (readSaved('queue', []).length) throw new Error('Sync pending expenses before signing out. Your entries are safe on this device.');
    await api('/api/account/logout', { method: 'POST', body: '{}' }); window.google?.accounts?.id?.disableAutoSelect(); localStorage.setItem('carryon:last-account', 'null'); setUser(null); load();
  }
  return { user, ready, error, googleClientId, canImportDevice, retry: load, authenticate, logout };
}
