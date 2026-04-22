import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardPage } from './DashboardPage';

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listTransactions: vi.fn(),
  listPayments: vi.fn(),
  listDeposits: vi.fn(),
  useAuth: vi.fn(),
}));

vi.mock('../../lib/bankingApi', () => ({
  accountsService: { list: mocks.listAccounts },
  transactionsService: { list: mocks.listTransactions },
  paymentsService: { list: mocks.listPayments },
  depositsService: { list: mocks.listDeposits },
}));

vi.mock('../auth/useAuth', () => ({
  useAuth: mocks.useAuth,
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/dashboard']}>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    mocks.listAccounts.mockReset();
    mocks.listTransactions.mockReset();
    mocks.listPayments.mockReset();
    mocks.listDeposits.mockReset();
    mocks.useAuth.mockReset();

    mocks.useAuth.mockReturnValue({
      user: { firstName: 'Ved', lastName: 'Joshi' },
    });
    mocks.listAccounts.mockResolvedValue([
      {
        id: 'acct_1',
        nickname: 'Checking',
        maskedNumber: '•••• 1111',
        type: 'Checking',
        balances: { availableBalance: 1000, currentBalance: 1000 },
      },
    ]);
    mocks.listTransactions.mockResolvedValue([]);
    mocks.listDeposits.mockResolvedValue([]);
  });

  it('shows only active upcoming payments and limits list to 5', async () => {
    mocks.listPayments.mockResolvedValue([
      { id: 'p1', payeeName: 'A', deliverBy: '2026-06-01', status: 'SCHEDULED', amount: 10 },
      { id: 'p2', payeeName: 'B', deliverBy: '2026-06-02', status: 'PROCESSING', amount: 11 },
      { id: 'p3', payeeName: 'C', deliverBy: '2026-06-03', status: 'SCHEDULED', amount: 12 },
      { id: 'p4', payeeName: 'D', deliverBy: '2026-06-04', status: 'PROCESSING', amount: 13 },
      { id: 'p5', payeeName: 'E', deliverBy: '2026-06-05', status: 'SCHEDULED', amount: 14 },
      { id: 'p6', payeeName: 'F', deliverBy: '2026-06-06', status: 'SCHEDULED', amount: 15 },
      { id: 'p7', payeeName: 'Done', deliverBy: '2026-06-07', status: 'COMPLETED', amount: 16 },
      { id: 'p8', payeeName: 'Cancelled', deliverBy: '2026-06-08', status: 'CANCELLED', amount: 17 },
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Upcoming bill payments')).toBeInTheDocument();
      expect(screen.getByText('A')).toBeInTheDocument();
      expect(screen.getByText('B')).toBeInTheDocument();
      expect(screen.getByText('C')).toBeInTheDocument();
      expect(screen.getByText('D')).toBeInTheDocument();
      expect(screen.getByText('E')).toBeInTheDocument();
      expect(screen.queryByText('F')).not.toBeInTheDocument();
      expect(screen.queryByText('Done')).not.toBeInTheDocument();
      expect(screen.queryByText('Cancelled')).not.toBeInTheDocument();
    });
  });
});
