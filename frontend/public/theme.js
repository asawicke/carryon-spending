// Apply the remembered theme before rendering the app to avoid a bright flash.
try {
  const selected = localStorage.getItem('carryon:theme');
  document.documentElement.dataset.theme = selected === 'light' || selected === 'dark' ? selected : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
} catch { document.documentElement.dataset.theme = 'light'; }
