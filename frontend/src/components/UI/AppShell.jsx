import React, { useCallback, useEffect, useRef } from 'react';
import { LogOut, Moon, Sun } from 'lucide-react';
import Logo from './Logo';
import useSwipeRow from '../../hooks/useSwipeRow';
import { useTheme } from '../../utils/theme';

/**
 * Shared page layout for students, teachers and admins.
 * Laptop: sidebar on the left. Phone: top bar + a row of mode chips you can swipe.
 *
 *   <AppShell
 *     navItems={[{ key: 'read_aloud', label: 'Read Aloud', icon: BookOpen }, { key: 'leaderboard', label: 'Leaderboard', icon: Award, section: 'Progress' }]}
 *     navTitle="Practice"
 *     activeKey={tab} onSelect={setTab}
 *     user={{ name: 'Student name', subtitle: 'Class name' }}
 *     onSignOut={handleSignOut}
 *   >
 *     ...page...
 *   </AppShell>
 */
function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export function AppShell({
  navItems = [],
  navTitle = 'Menu',
  activeKey,
  onSelect,
  user,
  onSignOut,
  footerNote,
  maxWidth = 'max-w-6xl',
  children,
}) {
  const [theme, toggleTheme] = useTheme();
  const ThemeIcon = theme === 'dark' ? Sun : Moon;
  const themeLabel = theme === 'dark' ? 'Light mode' : 'Dark mode';

  // Phone chip row: swipe/drag support, and keep the active chip in view
  const rowRef = useRef(null);
  const swipeRef = useSwipeRow();
  const setRowRef = useCallback((el) => { rowRef.current = el; swipeRef(el); }, [swipeRef]);
  useEffect(() => {
    const row = rowRef.current;
    const chip = row?.querySelector(`[data-nav="${activeKey}"]`);
    if (row && chip && row.scrollWidth > row.clientWidth) {
      row.scrollTo({ left: chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
    }
  }, [activeKey]);

  const signOutButton = (extra = '') => (
    <button
      type="button"
      onClick={onSignOut}
      aria-label="Sign out"
      title="Sign out"
      className={`w-11 h-11 shrink-0 flex items-center justify-center rounded-[10px] text-ink-subtle hover:text-danger hover:bg-danger-tint transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-ring ${extra}`}
    >
      <LogOut className="w-[18px] h-[18px]" aria-hidden="true" />
    </button>
  );

  return (
    <div className="min-h-screen bg-canvas text-ink md:flex">
      {/* ---------- Phone: top bar (scrolls away, so reading space is not lost) ---------- */}
      <div className="md:hidden bg-surface border-b border-line">
        <div className="flex items-center gap-2.5 px-4 pt-3 pb-2.5">
          <Logo size="sm" markOnly />
          <div className="flex-1 min-w-0 leading-tight">
            {user?.name && <div className="text-sm font-semibold truncate">{user.name}</div>}
            {user?.subtitle && <div className="text-xs text-ink-subtle truncate">{user.subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={themeLabel}
            title={themeLabel}
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-[10px] text-ink-subtle hover:text-ink hover:bg-surface-muted"
          >
            <ThemeIcon className="w-[18px] h-[18px]" aria-hidden="true" />
          </button>
          {onSignOut && signOutButton('border border-line')}
        </div>
        {navItems.length > 0 && (
          <nav aria-label={navTitle} ref={setRowRef} className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3">
            {navItems.map(({ key, label, shortLabel, icon: Icon }) => {
              const active = key === activeKey;
              return (
                <button
                  key={key}
                  type="button"
                  data-nav={key}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onSelect?.(key)}
                  className={`shrink-0 inline-flex items-center gap-2 h-10 px-3.5 rounded-full border text-sm whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-brand-tint border-brand text-brand-ink font-semibold'
                      : 'bg-surface border-line text-ink-muted font-medium'
                  }`}
                >
                  {Icon && <Icon className="w-4 h-4" aria-hidden="true" />}
                  {shortLabel || label}
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {/* ---------- Laptop: sidebar ---------- */}
      <aside className="hidden md:flex md:flex-col w-64 shrink-0 h-screen sticky top-0 bg-surface border-r border-line px-4 py-6 gap-7 overflow-y-auto">
        <div className="px-2">
          <Logo />
        </div>

        {navItems.length > 0 && (
          <nav aria-label={navTitle} className="flex flex-col gap-1">
            <span className="px-3 pb-1.5 text-xs font-semibold text-ink-subtle">{navTitle}</span>
            {navItems.map(({ key, label, icon: Icon, section }) => {
              const active = key === activeKey;
              return (
                <React.Fragment key={key}>
                  {section && <span className="px-3 pt-4 pb-1.5 text-xs font-semibold text-ink-subtle">{section}</span>}
                  <button
                    type="button"
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onSelect?.(key)}
                    className={`flex items-center gap-3 w-full min-h-[44px] px-3 rounded-[10px] text-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-ring ${
                      active
                        ? 'bg-brand-tint text-brand-ink font-semibold'
                        : 'text-ink-muted font-medium hover:bg-surface-muted hover:text-ink'
                    }`}
                  >
                    {Icon && <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />}
                    <span className="truncate">{label}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </nav>
        )}

        <div className="mt-auto flex flex-col gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex items-center gap-3 w-full min-h-[44px] px-3 rounded-[10px] text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors"
          >
            <ThemeIcon className="w-5 h-5" aria-hidden="true" />
            {themeLabel}
          </button>
          {user && (
            <div className="flex items-center gap-3 p-3 border border-line rounded-xl">
              <span
                className="w-9 h-9 shrink-0 rounded-full bg-brand-tint text-brand-ink flex items-center justify-center text-[13px] font-bold"
                aria-hidden="true"
              >
                {initials(user.name)}
              </span>
              <div className="flex-1 min-w-0 leading-tight">
                <div className="text-sm font-semibold truncate" title={user.name}>{user.name}</div>
                {user.subtitle && <div className="text-xs text-ink-subtle truncate mt-0.5">{user.subtitle}</div>}
              </div>
              {onSignOut && signOutButton('-mr-1.5')}
            </div>
          )}
          {footerNote && <p className="px-3 text-xs text-ink-subtle">{footerNote}</p>}
        </div>
      </aside>

      {/* ---------- Page ---------- */}
      <main className="flex-1 min-w-0">
        <div className={`w-full ${maxWidth} mx-auto px-4 py-5 md:px-10 md:py-10`}>{children}</div>
      </main>
    </div>
  );
}

export default AppShell;
