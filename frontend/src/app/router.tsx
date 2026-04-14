import { Navigate, createBrowserRouter } from 'react-router-dom';
import { AppShell } from '../components/layout';
import { AccountsPage, AccountDetailPage, OpenAccountPage } from '../features/accounts/AccountsPages';
import { AtmLocatorPage } from '../features/atm-locator/AtmLocatorPage';
import { BillPayPage, PayeesPage } from '../features/bill-pay/BillPayPages';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { DepositsPage, DepositDetailPage } from '../features/deposits/DepositPages';
import { LoginPage, RegisterPage, ResetPasswordPage, WelcomePage } from '../features/auth/AuthPages';
import { NotificationsPage } from '../features/notifications/NotificationsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { TransactionsPage } from '../features/transactions/TransactionsPage';
import { TransfersPage } from '../features/transfers/TransfersPage';
import { ProtectedRoute } from './ProtectedRoute';
import { AdminRoute } from './AdminRoute';
import { AdminPage } from '../features/admin/AdminPage';
import { AdminAccountsPage } from '../features/admin/AdminAccountsPage';

export const router = createBrowserRouter([
  { path: '/', element: <WelcomePage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: '/app',
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate replace to="/app/dashboard" /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'accounts', element: <AccountsPage /> },
          { path: 'accounts/new', element: <OpenAccountPage /> },
          { path: 'accounts/:accountId', element: <AccountDetailPage /> },
          { path: 'transfers', element: <TransfersPage /> },
          { path: 'bill-pay', element: <BillPayPage /> },
          { path: 'bill-pay/payees', element: <PayeesPage /> },
          { path: 'deposits', element: <DepositsPage /> },
          { path: 'deposits/:depositId', element: <DepositDetailPage /> },
          { path: 'transactions', element: <TransactionsPage /> },
          { path: 'atm-locator', element: <AtmLocatorPage /> },
          { path: 'notifications', element: <NotificationsPage /> },
          { path: 'settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
  {
    element: <AdminRoute />,
    children: [
      { path: '/admin', element: <AdminPage /> },
      { path: '/admin/accounts', element: <AdminAccountsPage /> },
    ],
  },
]);
