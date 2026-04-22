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
            <NavLink to="/app/notifications" className="utility-link">
              Notifications
            </NavLink>
            <NavLink to="/app/settings" className="utility-link">
              Settings
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
