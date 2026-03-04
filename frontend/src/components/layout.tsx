import { NavLink, Outlet } from 'react-router-dom';
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

export function AppShell() {
  const { user, signOut } = useAuth();

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand-lockup">
          <span className="brand-lockup__mark">SJ</span>
          <div className="brand-lockup__text">
            <strong>SJ State Bank</strong>
          </div>
        </div>
        <nav className="side-nav__menu">
          {navItems.map(([label, to]) => (
            <NavLink key={to} className={({ isActive }) => (isActive ? 'nav-link nav-link--active' : 'nav-link')} to={to}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="side-nav__footer">
          <div className="side-nav__profile">
            <span className="side-nav__profile-badge">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </span>
            <div>
              <p>{user?.firstName} {user?.lastName}</p>
              <small>Signed in</small>
            </div>
          </div>
          <button className="side-nav__signout" onClick={signOut} type="button">
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
      </div>
    </div>
  );
}
