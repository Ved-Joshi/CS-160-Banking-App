import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../lib/queryKeys';
import { TransfersPage } from './TransfersPage';

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  getProfile: vi.fn(),
  listPlans: vi.fn(),
  submitTransfer: vi.fn(),
  cancelPlan: vi.fn(),
}));

vi.mock('../../lib/bankingApi', () => ({
  accountsService: {
    list: mocks.listAccounts,
  },
  profileService: {
    get: mocks.getProfile,
  },
  transfersService: {
    listPlans: mocks.listPlans,
    submit: mocks.submitTransfer,
    cancelPlan: mocks.cancelPlan,
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

async function fillAndReviewScheduled() {
  await userEvent.selectOptions(screen.getByLabelText('Transfer mode'), 'SCHEDULED');
  await userEvent.clear(screen.getByLabelText('Start date'));
  await userEvent.type(screen.getByLabelText('Start date'), '2026-05-01');
  await userEvent.clear(screen.getByLabelText('Run time'));
  await userEvent.type(screen.getByLabelText('Run time'), '09:30');
  await userEvent.type(screen.getByLabelText('Amount'), '1250');
  await userEvent.type(screen.getByLabelText('Memo'), 'Recurring transfer');
  await userEvent.click(screen.getByRole('button', { name: 'Review scheduled transfer' }));
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
    mocks.getProfile.mockReset();
    mocks.listPlans.mockReset();
    mocks.cancelPlan.mockReset();
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
    mocks.getProfile.mockResolvedValue({ timezone: 'America/Los_Angeles' });
    mocks.listPlans.mockResolvedValue([]);
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
      mode: 'NOW',
      transfer: {
        id: 'tr_1',
        status: 'COMPLETED',
        submittedAt: '2026-03-05T00:00:00Z',
      },
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
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.transferPlans() });
      expect(screen.getByText('Transfer submitted')).toBeInTheDocument();
    });
  });

  it('submits scheduled transfer payload and shows scheduled result', async () => {
    mocks.submitTransfer.mockResolvedValue({
      mode: 'SCHEDULED',
      plan: {
        id: 'plan_1',
        status: 'SCHEDULED',
      },
    });

    renderPage();
    await waitForTransferFormReady();
    await fillAndReviewScheduled();
    await userEvent.click(screen.getByRole('button', { name: 'Create schedule' }));

    await waitFor(() => {
      expect(mocks.submitTransfer).toHaveBeenCalledTimes(1);
      expect(mocks.submitTransfer.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
        scheduleMode: 'SCHEDULED',
        cadence: 'Once',
        startDate: '2026-05-01',
        runTime: '09:30',
        timezone: 'America/Los_Angeles',
        memo: 'Recurring transfer',
      }));
      expect(screen.getByText('Scheduled transfer created')).toBeInTheDocument();
    });
  });

  it('lists scheduled transfers and cancels plan', async () => {
    mocks.listPlans.mockResolvedValue([
      {
        id: 'plan_live',
        amount: 50,
        cadence: 'Weekly',
        runTime: '08:00',
        timezone: 'America/Los_Angeles',
        nextRunAt: '2026-05-02T15:00:00Z',
        status: 'SCHEDULED',
      },
    ]);
    mocks.cancelPlan.mockResolvedValue({
      id: 'plan_live',
      status: 'CANCELLED',
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Scheduled transfers')).toBeInTheDocument();
      expect(screen.getByText(/\$50\.00/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.getByText('Cancel Weekly transfer?')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Confirm cancel' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Confirm cancel' }));

    await waitFor(() => {
      expect(mocks.cancelPlan.mock.calls[0]?.[0]).toBe('plan_live');
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
