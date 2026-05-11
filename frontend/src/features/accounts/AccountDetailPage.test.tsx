import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountDetailPage } from './AccountsPages';

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  closeAccount: vi.fn(),
  listTransactions: vi.fn(),
}));

vi.mock('../../lib/bankingApi', () => ({
  accountsService: {
    get: mocks.getAccount,
    close: mocks.closeAccount,
  },
  transactionsService: {
    list: mocks.listTransactions,
  },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/accounts/acct_1']}>
        <Routes>
          <Route path="/app/accounts/:accountId" element={<AccountDetailPage />} />
          <Route path="/app/accounts" element={<div>accounts page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccountDetailPage', () => {
  beforeEach(() => {
    mocks.getAccount.mockReset();
    mocks.closeAccount.mockReset();
    mocks.listTransactions.mockReset();
  });

  it('shows backend close failure reason when close request fails', async () => {
    mocks.getAccount.mockResolvedValue({
      id: 'acct_1',
      nickname: 'Everyday Checking',
      type: 'Checking',
      maskedNumber: '•••• 1234',
      status: 'Open',
      routingNumber: '121000358',
      openedAt: '2026-01-01T00:00:00Z',
      closeEligible: true,
      canClose: true,
      closeReasons: [],
      balances: {
        availableBalance: 100,
        currentBalance: 100,
      },
    });
    mocks.listTransactions.mockResolvedValue([]);
    mocks.closeAccount.mockRejectedValue(new Error("This account can't be closed yet.: Account balance must be zero to close."));

    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Close account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm close' }));

    await waitFor(() => {
      expect(screen.getByText('Unable to close account')).toBeInTheDocument();
      expect(screen.getByText(/Account balance must be zero to close/)).toBeInTheDocument();
    });
  });

  it('does not render routing details for credit accounts', async () => {
    mocks.getAccount.mockResolvedValue({
      id: 'acct_credit',
      nickname: 'Travel Credit',
      type: 'Credit',
      maskedNumber: '•••• 1234',
      status: 'Open',
      routingNumber: undefined,
      openedAt: '2026-01-01T00:00:00Z',
      closeEligible: false,
      canClose: false,
      closeReasons: ['Balance remains outstanding.'],
      balances: {
        availableBalance: 100,
        currentBalance: 100,
      },
    });
    mocks.listTransactions.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText('Travel Credit')).toBeInTheDocument();
    expect(screen.queryByText(/^Routing$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Routing /)).not.toBeInTheDocument();
  });
});
