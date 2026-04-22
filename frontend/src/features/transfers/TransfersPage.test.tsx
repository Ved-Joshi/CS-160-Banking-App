import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../lib/queryKeys';
import { TransfersPage } from './TransfersPage';

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  getProfile: vi.fn(),
  selfSubmit: vi.fn(),
  resolveRecipient: vi.fn(),
  memberSubmit: vi.fn(),
  memberListPlans: vi.fn(),
  memberCancelPlan: vi.fn(),
  externalListAccounts: vi.fn(),
  externalCreateAccount: vi.fn(),
  externalSubmit: vi.fn(),
  externalListPlans: vi.fn(),
  externalListTransfers: vi.fn(),
  externalCancelPlan: vi.fn(),
}));

vi.mock('../../lib/bankingApi', () => ({
  accountsService: {
    list: mocks.listAccounts,
  },
  profileService: {
    get: mocks.getProfile,
  },
  transfersService: {
    submit: mocks.selfSubmit,
  },
  memberTransfersService: {
    resolveRecipient: mocks.resolveRecipient,
    submit: mocks.memberSubmit,
    listPlans: mocks.memberListPlans,
    cancelPlan: mocks.memberCancelPlan,
  },
  externalAccountsService: {
    list: mocks.externalListAccounts,
    create: mocks.externalCreateAccount,
  },
  externalTransfersService: {
    submit: mocks.externalSubmit,
    listPlans: mocks.externalListPlans,
    list: mocks.externalListTransfers,
    cancelPlan: mocks.externalCancelPlan,
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

describe('TransfersPage', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.listAccounts.mockResolvedValue([
      { id: 'acct_checking', nickname: 'Everyday Checking', maskedNumber: '•••• 1111', type: 'Checking', status: 'Open' },
      { id: 'acct_savings', nickname: 'Rainy Day Savings', maskedNumber: '•••• 2222', type: 'Savings', status: 'Open' },
    ]);
    mocks.getProfile.mockResolvedValue({ timezone: 'America/Los_Angeles' });
    mocks.memberListPlans.mockResolvedValue([]);
    mocks.externalListAccounts.mockResolvedValue([
      { id: 'ext_1', bankName: 'Chase', nickname: 'Travel fund', maskedAccountNumber: '...1234', accountType: 'Checking', verificationStatus: 'VERIFIED', isActive: true },
    ]);
    mocks.externalListPlans.mockResolvedValue([]);
    mocks.externalListTransfers.mockResolvedValue([]);
  });

  it('submits an immediate self transfer and invalidates core queries', async () => {
    mocks.selfSubmit.mockResolvedValue({
      id: 'tr_1',
      status: 'COMPLETED',
      submittedAt: '2026-04-22T10:00:00Z',
    });

    const { invalidateSpy } = renderPage();

    const amountInput = screen.getByLabelText('Amount');
    fireEvent.keyDown(amountInput, { key: '2' });
    fireEvent.keyDown(amountInput, { key: '5' });
    await userEvent.type(screen.getByLabelText('Memo'), 'Utilities');
    await userEvent.click(screen.getByRole('button', { name: 'Review transfer' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit transfer' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Submit transfer' }));

    await waitFor(() => {
      expect(mocks.selfSubmit.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
        fromAccountId: 'acct_checking',
        toAccountId: 'acct_savings',
        amount: 25,
      }));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.accounts() });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.transactions() });
      expect(screen.getByText('Transfer submitted')).toBeInTheDocument();
    });
  });

  it('resolves a member recipient on review/submit path', async () => {
    mocks.resolveRecipient.mockResolvedValue({
      userId: 'user_2',
      displayName: 'Alex Nguyen',
      email: 'alex@example.com',
      defaultCheckingAccountMasked: '...3344',
    });

    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Another SJ State user' }));
    await userEvent.type(screen.getByLabelText('Recipient email'), 'alex@example.com');
    await userEvent.type(screen.getByLabelText('Amount'), '1200');
    await userEvent.click(screen.getByRole('button', { name: 'Review member transfer' }));

    await waitFor(() => {
      expect(mocks.resolveRecipient.mock.calls[0]?.[0]).toBe('alex@example.com');
      expect(screen.getAllByText(/Alex Nguyen/).length).toBeGreaterThan(0);
    });
  });

  it('submits a scheduled member transfer', async () => {
    mocks.resolveRecipient.mockResolvedValue({
      userId: 'user_2',
      displayName: 'Alex Nguyen',
      email: 'alex@example.com',
      defaultCheckingAccountMasked: '...3344',
    });
    mocks.memberSubmit.mockResolvedValue({
      mode: 'SCHEDULED',
      plan: { id: 'plan_1', status: 'SCHEDULED' },
    });

    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'Another SJ State user' }));
    await userEvent.type(screen.getByLabelText('Recipient email'), 'alex@example.com');

    await userEvent.selectOptions(screen.getByLabelText('Transfer mode'), 'SCHEDULED');
    await userEvent.clear(screen.getByLabelText('Member start date'));
    await userEvent.type(screen.getByLabelText('Member start date'), '2099-05-01');
    await userEvent.clear(screen.getByLabelText('Member run time'));
    await userEvent.type(screen.getByLabelText('Member run time'), '09:30');
    await userEvent.type(screen.getByLabelText('Amount'), '1250');
    await userEvent.click(screen.getByRole('button', { name: 'Review scheduled member transfer' }));
    await waitFor(() => {
      expect(screen.getAllByText(/Alex Nguyen/).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Create schedule' })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Create schedule' }));

    await waitFor(() => {
      expect(mocks.memberSubmit.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
        recipientEmail: 'alex@example.com',
        scheduleMode: 'SCHEDULED',
        cadence: 'Once',
        startDate: '2099-05-01',
        runTime: '09:30',
      }));
      expect(mocks.resolveRecipient.mock.calls[0]?.[0]).toBe('alex@example.com');
      expect(screen.getByText('Scheduled member transfer created')).toBeInTheDocument();
    });
  });

  it('creates an external account inline', async () => {
    mocks.externalCreateAccount.mockResolvedValue({
      id: 'ext_2',
      bankName: 'Wells Fargo',
      nickname: 'Bills',
      maskedAccountNumber: '...7777',
      accountType: 'Checking',
      verificationStatus: 'VERIFIED',
      isActive: true,
    });

    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'External bank' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add external account' }));
    await userEvent.type(screen.getByLabelText('Bank name'), 'Wells Fargo');
    await userEvent.type(screen.getByLabelText('External nickname'), 'Bills');
    await userEvent.type(screen.getByLabelText('Routing number'), '121000248');
    await userEvent.type(screen.getByLabelText('Account number'), '12345678');
    await userEvent.type(screen.getByLabelText('Confirm account number'), '12345678');
    await userEvent.click(screen.getByRole('button', { name: 'Save external account' }));

    await waitFor(() => {
      expect(mocks.externalCreateAccount.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
        bankName: 'Wells Fargo',
        nickname: 'Bills',
      }));
      expect(screen.getByText('External account linked')).toBeInTheDocument();
    });
  });

  it('blocks invalid external account details before submit', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'External bank' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add external account' }));
    await userEvent.type(screen.getByLabelText('Bank name'), 'Wells Fargo');
    await userEvent.type(screen.getByLabelText('External nickname'), 'Bills');
    await userEvent.type(screen.getByLabelText('Routing number'), '123456789');
    await userEvent.type(screen.getByLabelText('Account number'), '12345678');
    await userEvent.type(screen.getByLabelText('Confirm account number'), '12345678');
    await userEvent.click(screen.getByRole('button', { name: 'Save external account' }));

    await waitFor(() => {
      expect(mocks.externalCreateAccount).not.toHaveBeenCalled();
      expect(screen.getByText('Routing number is invalid.')).toBeInTheDocument();
    });
  });

  it('submits an external transfer from checking only', async () => {
    mocks.externalSubmit.mockResolvedValue({
      mode: 'NOW',
      transfer: { id: 'ext_tr_1', status: 'PROCESSING' },
    });

    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'External bank' }));
    await userEvent.type(screen.getByLabelText('Amount'), '5000');
    await userEvent.click(screen.getByRole('button', { name: 'Review external transfer' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Submit external transfer' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Submit external transfer' }));

    await waitFor(() => {
      expect(mocks.externalSubmit.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
        fromAccountId: 'acct_checking',
        externalAccountId: 'ext_1',
        amount: 50,
      }));
      expect(screen.getByText('External transfer submitted')).toBeInTheDocument();
    });
  });
});
