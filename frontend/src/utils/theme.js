import { useCallback, useEffect, useState } from 'react';

// Light is the default. The choice is remembered on this device only.
// index.html applies a saved "dark" choice before the page paints.
const KEY = 'hrefspeak-theme';

export function getTheme() {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode or blocked storage: the choice just won't be remembered */
  }
}

/** `const [theme, toggleTheme] = useTheme();` */
export function useTheme() {
  const [theme, setTheme] = useState(getTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);
  return [theme, toggle];
}
