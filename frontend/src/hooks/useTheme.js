import { useEffect, useState } from 'react';
export default function useTheme() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('carryon:theme') || 'system'; } catch { return 'system'; } });
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const selected = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = selected;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', selected === 'dark' ? '#061e2b' : '#003d5b');
    };
    apply(); media.addEventListener('change', apply);
    try { localStorage.setItem('carryon:theme', theme); } catch { /* Browser storage can be disabled. */ }
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return { theme, setTheme };
}
