import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../lib/queryKeys';
import { TransfersPage } from './TransfersPage';

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  submitTransfer: vi.fn(),
}));

vi.mock('../../lib/bankingApi', () => ({
  accountsService: {
    list: mocks.listAccounts,
  },
  transfersService: {
    submit: mocks.submitTransfer,
  },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/transfers']}>
        <TransfersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { invalidateSpy };
}

async function fillAndReview() {
  await userEvent.type(screen.getByLabelText('Amount'), '25');
  await userEvent.type(screen.getByLabelText('Memo'), 'Rent split');
  await userEvent.click(screen.getByRole('button', { name: 'Review transfer' }));
}

async function waitForTransferFormReady() {
  await waitFor(() => {
    const fromSelect = screen.getByLabelText('From account') as HTMLSelectElement;
    expect(fromSelect.disabled).toBe(false);
    expect(fromSelect.options.length).toBeGreaterThan(1);
  });
}

describe('TransfersPage', () => {
  beforeEach(() => {
    mocks.listAccounts.mockReset();
    mocks.submitTransfer.mockReset();
    mocks.listAccounts.mockResolvedValue([
      {
        id: 'acct_1',
        nickname: 'Checking',
        maskedNumber: '•••• 1111',
      },
      {
        id: 'acct_2',
        nickname: 'Savings',
        maskedNumber: '•••• 2222',
      },
    ]);
  });

  it('prevents selecting the same account for destination', async () => {
    renderPage();
    await waitForTransferFormReady();

    const fromSelect = screen.getByLabelText('From account');
    const toSelect = screen.getByLabelText('To account') as HTMLSelectElement;
    await userEvent.selectOptions(fromSelect, 'acct_1');

    await waitFor(() => {
      const optionValues = Array.from(toSelect.options).map((option) => option.value);
      expect(optionValues).not.toContain('acct_1');
    });
  });

  it('submits transfer and invalidates account/transaction/notification queries', async () => {
    mocks.submitTransfer.mockResolvedValue({
      id: 'tr_1',
      status: 'COMPLETED',
      submittedAt: '2026-03-05T00:00:00Z',
    });

    const { invalidateSpy } = renderPage();
    await waitForTransferFormReady();
    await fillAndReview();
    await userEvent.click(screen.getByRole('button', { name: 'Submit transfer' }));

    await waitFor(() => {
      expect(mocks.submitTransfer).toHaveBeenCalledTimes(1);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.accounts() });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.transactions() });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.notifications() });
      expect(screen.getByText('Transfer submitted')).toBeInTheDocument();
    });
  });

  it('shows backend transfer error details', async () => {
    mocks.submitTransfer.mockRejectedValue(new Error('Insufficient balance.'));

    renderPage();
    await waitForTransferFormReady();
    await fillAndReview();
    await userEvent.click(screen.getByRole('button', { name: 'Submit transfer' }));

    await waitFor(() => {
      expect(screen.getByText('Transfer could not be submitted')).toBeInTheDocument();
      expect(screen.getByText('Insufficient balance.')).toBeInTheDocument();
    });
  });
});
