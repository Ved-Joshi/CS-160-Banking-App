import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../lib/queryKeys';
import { BillPayPage } from './BillPayPages';

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listPayees: vi.fn(),
  createPayee: vi.fn(),
  listPayments: vi.fn(),
  createPayment: vi.fn(),
  cancelPayment: vi.fn(),
  updatePayment: vi.fn(),
  retryPayment: vi.fn(),
}));

vi.mock('../../lib/bankingApi', () => ({
  accountsService: {
    list: mocks.listAccounts,
  },
  payeesService: {
    list: mocks.listPayees,
    create: mocks.createPayee,
  },
  paymentsService: {
    list: mocks.listPayments,
    create: mocks.createPayment,
    cancel: mocks.cancelPayment,
    update: mocks.updatePayment,
    retry: mocks.retryPayment,
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
    mocks.createPayee.mockReset();
    mocks.createPayment.mockReset();
    mocks.cancelPayment.mockReset();
    mocks.updatePayment.mockReset();
    mocks.retryPayment.mockReset();

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

  it('submits daily payment payload', async () => {
    mocks.createPayment.mockResolvedValue({ id: 'pay_daily', status: 'SCHEDULED' });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Schedule payment' })).toBeEnabled();
    });

    await userEvent.type(screen.getByLabelText('Amount'), '2500');
    await userEvent.selectOptions(screen.getByLabelText('Cadence'), 'Daily');
    await userEvent.click(screen.getByRole('button', { name: 'Schedule payment' }));

    await waitFor(() => {
      expect(mocks.createPayment).toHaveBeenCalledTimes(1);
      expect(mocks.createPayment.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
        cadence: 'Daily',
        amount: 25,
      }));
    });
  });

  it('creates a first-time payee from the add-payee modal', async () => {
    mocks.listPayees.mockResolvedValue([]);
    mocks.createPayee.mockResolvedValue({
      id: 'payee_new',
      name: 'Comcast',
      category: 'Internet',
      accountMask: '...5678',
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '+ Add payee' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: '+ Add payee' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Add payee' })).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Payee name'), { target: { value: 'Comcast' } });
    await userEvent.selectOptions(within(dialog).getByLabelText('Category'), 'Internet');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add payee' }));

    await waitFor(() => {
      expect(mocks.createPayee).toHaveBeenCalledTimes(1);
      expect(mocks.createPayee.mock.calls[0]?.[0]).toEqual({
        name: 'Comcast',
        category: 'Internet',
      });
    });
  });

  it('shows delete for scheduled/processing/failed and confirms cancel', async () => {
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
        status: 'FAILED',
        amount: 20,
      },
      {
        id: 'pay_3',
        payeeName: 'Phone',
        deliverBy: '2026-06-02',
        cadence: 'Monthly',
        status: 'COMPLETED',
        amount: 20,
      },
    ]);
    mocks.cancelPayment.mockResolvedValue({ id: 'pay_1', status: 'CANCELLED' });

    const { invalidateSpy } = renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete PG&E payment' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete Water payment' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete Phone payment' })).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Delete PG&E payment' }));
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

  it('hides cancelled and completed one-time payments from the scheduled payments list', async () => {
    mocks.listPayments.mockResolvedValue([
      {
        id: 'pay_active',
        payeeName: 'PG&E',
        deliverBy: '2026-06-01',
        cadence: 'Weekly',
        status: 'SCHEDULED',
        amount: 50,
      },
      {
        id: 'pay_cancelled',
        payeeName: 'Old Utility',
        deliverBy: '2026-06-02',
        cadence: 'Monthly',
        status: 'CANCELLED',
        amount: 20,
      },
      {
        id: 'pay_once_completed',
        payeeName: 'One-time finished',
        deliverBy: '2026-06-02',
        cadence: 'Once',
        status: 'COMPLETED',
        amount: 10,
      },
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.queryByText('Old Utility')).not.toBeInTheDocument();
      expect(screen.queryByText('One-time finished')).not.toBeInTheDocument();
      expect(screen.getAllByRole('row')).toHaveLength(2);
    });
  });

  it('retries failed payment and updates an existing scheduled payment', async () => {
    mocks.listPayments.mockResolvedValue([
      {
        id: 'pay_failed',
        payeeName: 'PG&E',
        payeeId: 'payee_1',
        deliverBy: '2026-06-01',
        cadence: 'Weekly',
        status: 'FAILED',
        amount: 50,
      },
      {
        id: 'pay_scheduled',
        payeeName: 'Water',
        payeeId: 'payee_1',
        deliverBy: '2026-06-04',
        cadence: 'Weekly',
        status: 'SCHEDULED',
        amount: 30,
      },
    ]);
    mocks.retryPayment.mockResolvedValue({
      id: 'pay_failed',
      payeeName: 'PG&E',
      payeeId: 'payee_1',
      accountId: 'acct_1',
      amount: 50,
      cadence: 'Weekly',
      deliverBy: '2026-06-08',
      status: 'SCHEDULED',
    });
    mocks.updatePayment.mockResolvedValue({ id: 'pay_failed', status: 'SCHEDULED' });

    const { invalidateSpy } = renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry PG&E payment' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry Water payment' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Edit PG&E payment' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit Water payment' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Retry PG&E payment' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Retry now' }));
    await waitFor(() => {
      expect(mocks.retryPayment).toHaveBeenCalled();
      expect(mocks.retryPayment.mock.calls[0]?.[0]).toBe('pay_failed');
    });

    await userEvent.click(screen.getByRole('button', { name: 'Edit Water payment' }));
    const dialog = await screen.findByRole('dialog');
    const editAmountInput = within(dialog).getByLabelText('Amount');
    fireEvent.paste(editAmountInput, {
      clipboardData: { getData: () => '75' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      expect(mocks.updatePayment).toHaveBeenCalledTimes(1);
      expect(mocks.updatePayment.mock.calls[0]?.[0]).toBe('pay_scheduled');
      expect(mocks.updatePayment.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ amount: 75 }));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.payments() });
    });
  });

  it('supports delaying from retry confirmation for failed payments', async () => {
    mocks.listPayments.mockResolvedValue([
      {
        id: 'pay_failed',
        payeeName: 'PG&E',
        payeeId: 'payee_1',
        deliverBy: '2026-06-01',
        cadence: 'Weekly',
        status: 'FAILED',
        amount: 50,
      },
      {
        id: 'pay_processing',
        payeeName: 'Phone',
        payeeId: 'payee_1',
        deliverBy: '2026-06-02',
        cadence: 'Weekly',
        status: 'PROCESSING',
        amount: 25,
      },
    ]);
    mocks.updatePayment.mockResolvedValue({ id: 'pay_failed', status: 'SCHEDULED' });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Retry PG&E payment' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry Phone payment' })).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Retry PG&E payment' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Delay to date'), { target: { value: '2026-06-10' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delay instead' }));

    await waitFor(() => {
      expect(mocks.updatePayment).toHaveBeenCalledWith('pay_failed', expect.objectContaining({ deliverBy: '2026-06-10' }));
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
