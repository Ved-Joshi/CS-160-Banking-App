import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../lib/queryKeys';
import { BillPayPage } from './BillPayPages';

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listPayees: vi.fn(),
  listPayments: vi.fn(),
  createPayment: vi.fn(),
  cancelPayment: vi.fn(),
}));

vi.mock('../../lib/bankingApi', () => ({
  accountsService: {
    list: mocks.listAccounts,
  },
  payeesService: {
    list: mocks.listPayees,
  },
  paymentsService: {
    list: mocks.listPayments,
    create: mocks.createPayment,
    cancel: mocks.cancelPayment,
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
      <MemoryRouter initialEntries={['/app/bill-pay']}>
        <BillPayPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { invalidateSpy };
}

describe('BillPayPage', () => {
  beforeEach(() => {
    mocks.listAccounts.mockReset();
    mocks.listPayees.mockReset();
    mocks.listPayments.mockReset();
    mocks.createPayment.mockReset();
    mocks.cancelPayment.mockReset();

    mocks.listAccounts.mockResolvedValue([
      { id: 'acct_1', nickname: 'Checking' },
      { id: 'acct_2', nickname: 'Savings' },
    ]);
    mocks.listPayees.mockResolvedValue([
      { id: 'payee_1', name: 'PG&E' },
    ]);
    mocks.listPayments.mockResolvedValue([]);
  });

  it('submits weekly payment payload', async () => {
    mocks.createPayment.mockResolvedValue({ id: 'pay_new', status: 'SCHEDULED' });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Schedule payment' })).toBeEnabled();
    });

    await userEvent.type(screen.getByLabelText('Amount'), '1234');
    await userEvent.selectOptions(screen.getByLabelText('Cadence'), 'Weekly');
    await userEvent.click(screen.getByRole('button', { name: 'Schedule payment' }));

    await waitFor(() => {
      expect(mocks.createPayment).toHaveBeenCalledTimes(1);
      expect(mocks.createPayment.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
        cadence: 'Weekly',
        amount: 12.34,
      }));
    });
  });

  it('shows cancel only for scheduled/processing and confirms cancel', async () => {
    mocks.listPayments.mockResolvedValue([
      {
        id: 'pay_1',
        payeeName: 'PG&E',
        deliverBy: '2026-06-01',
        cadence: 'Weekly',
        status: 'SCHEDULED',
        amount: 50,
      },
      {
        id: 'pay_2',
        payeeName: 'Water',
        deliverBy: '2026-06-02',
        cadence: 'Monthly',
        status: 'COMPLETED',
        amount: 20,
      },
    ]);
    mocks.cancelPayment.mockResolvedValue({ id: 'pay_1', status: 'CANCELLED' });

    const { invalidateSpy } = renderPage();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
    });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.getByText('Cancel PG&E payment?')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }));

    await waitFor(() => {
      expect(mocks.cancelPayment.mock.calls[0]?.[0]).toBe('pay_1');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.payments() });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.notifications() });
    });
  });

  it('blocks scheduling with past deliver-by date', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Schedule payment' })).toBeEnabled();
    });

    await userEvent.type(screen.getByLabelText('Amount'), '500');
    await userEvent.clear(screen.getByLabelText('Deliver by'));
    await userEvent.type(screen.getByLabelText('Deliver by'), '2000-01-01');
    await userEvent.click(screen.getByRole('button', { name: 'Schedule payment' }));

    await waitFor(() => {
      expect(mocks.createPayment).not.toHaveBeenCalled();
      expect(screen.getByText('Deliver by date cannot be in the past.')).toBeInTheDocument();
    });
  });
});
