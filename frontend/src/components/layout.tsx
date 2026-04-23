import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Dialog } from './ui';
import { useAuth } from '../features/auth/useAuth';

const navItems = [
  ['Dashboard', '/app/dashboard'],
  ['Accounts', '/app/accounts'],
  ['Transfers', '/app/transfers'],
  ['Bill Pay', '/app/bill-pay'],
  ['Deposits', '/app/deposits'],
  ['Transactions', '/app/transactions'],
  ['ATM Locator', '/app/atm-locator'],
] as const;

const mobilePrimaryNav = [
  ['Dashboard', '/app/dashboard'],
  ['Accounts', '/app/accounts'],
  ['Transfers', '/app/transfers'],
  ['Bill Pay', '/app/bill-pay'],
] as const;

const mobileMoreNav = [
  ['Deposits', '/app/deposits'],
  ['Transactions', '/app/transactions'],
  ['ATM Locator', '/app/atm-locator'],
  ['Notifications', '/app/notifications'],
  ['Settings', '/app/settings'],
] as const;

export function AppShell() {
  const { user, signOut, isAdmin } = useAuth();
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || user?.email || 'Signed in';
  const initials = `${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`
    || user?.username?.slice(0, 2).toUpperCase()
    || user?.email?.slice(0, 2).toUpperCase()
    || 'SJ';

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <NavLink className="brand-lockup" to="/app/dashboard">
          <span className="brand-lockup__mark">SJ</span>
          <div className="brand-lockup__text">
            <strong>SJ State Bank</strong>
          </div>
        </NavLink>
        <nav className="side-nav__menu">
          {navItems.map(([label, to]) => (
            <NavLink key={to} className={({ isActive }) => (isActive ? 'nav-link nav-link--active' : 'nav-link')} to={to}>
              {label}
            </NavLink>
          ))}
          {isAdmin ? (
            <NavLink className={({ isActive }) => (isActive ? 'nav-link nav-link--active' : 'nav-link')} to="/admin">
              Admin
            </NavLink>
          ) : null}
        </nav>
        <div className="side-nav__footer">
          <div className="side-nav__profile">
            <span className="side-nav__profile-badge">{initials}</span>
            <div>
              <p>{displayName}</p>
              <small>Signed in</small>
            </div>
          </div>
          <button className="side-nav__signout" onClick={() => { void signOut(); }} type="button">
            Sign out
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="top-header">
          <div>
            <p className="eyebrow">Personal Banking</p>
            <h2>Customer Portal</h2>
          </div>
          <div className="top-header__actions">
            <NavLink
              aria-label="Notifications"
              className={({ isActive }) => (isActive ? 'top-header__icon-link top-header__icon-link--active' : 'top-header__icon-link')}
              title="Notifications"
              to="/app/notifications"
            >
              <svg aria-hidden="true" className="top-header__icon-svg top-header__icon-svg--notifications" viewBox="0 0 24 24">
                <path d="M12 2a6 6 0 0 0-6 6v3.6l-1.7 2.8A1 1 0 0 0 5.1 16h13.8a1 1 0 0 0 .8-1.6L18 11.6V8a6 6 0 0 0-6-6Zm0 20a3 3 0 0 0 2.8-2H9.2A3 3 0 0 0 12 22Z" />
              </svg>
            </NavLink>
            <NavLink
              aria-label="Settings"
              className={({ isActive }) => (isActive ? 'top-header__icon-link top-header__icon-link--active' : 'top-header__icon-link')}
              title="Settings"
              to="/app/settings"
            >
              <svg aria-hidden="true" className="top-header__icon-svg top-header__icon-svg--settings" viewBox="0 0 416 432">
                <path d="m366 237l45 35q7 6 3 14l-43 74q-4 8-13 4l-53-21q-18 13-36 21l-8 56q-1 9-11 9h-85q-9 0-11-9l-8-56q-19-8-36-21l-53 21q-9 3-13-4L1 286q-4-8 3-14l45-35q-1-12-1-21t1-21L4 160q-7-6-3-14l43-74q5-8 13-4l53 21q18-13 36-21l8-56q2-9 11-9h85q10 0 11 9l8 56q19 8 36 21l53-21q9-3 13 4l43 74q4 8-3 14l-45 35q2 12 2 21t-2 21zm-158.5 54q30.5 0 52.5-22t22-53t-22-53t-52.5-22t-52.5 22t-22 53t22 53t52.5 22z" />
              </svg>
            </NavLink>
          </div>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
        <nav aria-label="Mobile navigation" className="mobile-tabbar">
          {mobilePrimaryNav.map(([label, to]) => (
            <NavLink key={to} className={({ isActive }) => (isActive ? 'mobile-tabbar__link mobile-tabbar__link--active' : 'mobile-tabbar__link')} to={to}>
              {label}
            </NavLink>
          ))}
          <button
            className={mobileMoreOpen ? 'mobile-tabbar__link mobile-tabbar__link--active' : 'mobile-tabbar__link'}
            onClick={() => setMobileMoreOpen(true)}
            type="button"
          >
            More
          </button>
        </nav>
      </div>
      <Dialog
        description="Quick access to the rest of your banking tabs."
        onClose={() => setMobileMoreOpen(false)}
        open={mobileMoreOpen}
        title="More tabs"
      >
        <div className="mobile-more-grid">
          {mobileMoreNav.map(([label, to]) => (
            <Link
              className="button button--secondary mobile-more-grid__link"
              key={to}
              onClick={() => setMobileMoreOpen(false)}
              to={to}
            >
              {label}
            </Link>
          ))}
          {isAdmin ? (
            <Link
              className="button button--secondary mobile-more-grid__link"
              onClick={() => setMobileMoreOpen(false)}
              to="/admin"
            >
              Admin
            </Link>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
