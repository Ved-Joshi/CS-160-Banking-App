import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DepositsPage } from './DepositPages';

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listDeposits: vi.fn(),
  createUploadUrls: vi.fn(),
  createDeposit: vi.fn(),
  submitAtmWithdrawal: vi.fn(),
}));

vi.mock('../../lib/bankingApi', () => ({
  accountsService: {
    list: mocks.listAccounts,
  },
  depositsService: {
    list: mocks.listDeposits,
    createUploadUrls: mocks.createUploadUrls,
    create: mocks.createDeposit,
  },
  withdrawalsService: {
    submitAtm: mocks.submitAtmWithdrawal,
  },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/deposits']}>
        <DepositsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function waitForAccountsLoaded() {
  await waitFor(() => {
    expect(screen.getByRole('option', { name: /Everyday Checking/ })).toBeInTheDocument();
  });
}

describe('DepositsPage', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    Object.values(mocks).forEach((mock) => mock.mockReset());

    mocks.listAccounts.mockResolvedValue([
      { id: 'acct_checking', nickname: 'Everyday Checking', maskedNumber: '•••• 1111', type: 'Checking', status: 'Open' },
      { id: 'acct_savings', nickname: 'Savings', maskedNumber: '•••• 2222', type: 'Savings', status: 'Open' },
    ]);
    mocks.listDeposits.mockResolvedValue([]);
    mocks.createDeposit.mockResolvedValue({
      id: 'dep_1',
      accountId: 'acct_checking',
      amount: 25,
      depositType: 'atm',
      submittedAt: '2026-04-26T10:00:00Z',
      status: 'APPROVED',
      images: {},
    });
    mocks.submitAtmWithdrawal.mockResolvedValue({
      id: 'wd_1',
      status: 'COMPLETED',
      submittedAt: '2026-04-26T10:00:00Z',
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits an ATM deposit', async () => {
    renderPage();
    await waitForAccountsLoaded();

    await userEvent.selectOptions(screen.getByLabelText('Deposit method'), 'atm');
    fireEvent.keyDown(screen.getByLabelText('Deposit amount'), { key: '2' });
    fireEvent.keyDown(screen.getByLabelText('Deposit amount'), { key: '5' });
    await userEvent.click(screen.getByRole('button', { name: 'Submit deposit' }));

    await waitFor(() => {
      expect(mocks.createDeposit.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
        accountId: 'acct_checking',
        amount: 25,
        depositMethod: 'atm',
        depositType: 'cash',
      }));
      expect(mockNavigate).toHaveBeenCalledWith('/app/deposits/dep_1');
    });
  });

  it('submits a check deposit with uploaded images', async () => {
    mocks.createUploadUrls.mockResolvedValue({
      bucket: 'deposit-check-images',
      front: { path: 'user/front.jpg', token: 't1', signedUrl: 'https://upload/front' },
      back: { path: 'user/back.jpg', token: 't2', signedUrl: 'https://upload/back' },
    });

    renderPage();
    await waitForAccountsLoaded();

    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    expect(fileInputs.length).toBeGreaterThanOrEqual(2);
    const frontInput = fileInputs[0];
    const backInput = fileInputs[1];
    const frontFile = new File(['a'.repeat(2048)], 'front.jpg', { type: 'image/jpeg' });
    const backFile = new File(['b'.repeat(2048)], 'back.jpg', { type: 'image/jpeg' });

    fireEvent.change(frontInput, { target: { files: [frontFile] } });
    fireEvent.change(backInput, { target: { files: [backFile] } });
    fireEvent.keyDown(screen.getByLabelText('Deposit amount'), { key: '3' });
    fireEvent.keyDown(screen.getByLabelText('Deposit amount'), { key: '0' });
    await userEvent.click(screen.getByRole('button', { name: 'Submit deposit' }));

    await waitFor(() => {
      expect(mocks.createUploadUrls).toHaveBeenCalledWith(expect.objectContaining({
        frontFileName: 'front.jpg',
        backFileName: 'back.jpg',
      }));
      expect(mocks.createDeposit.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
        depositMethod: 'check',
        depositType: 'check',
        frontImagePath: 'user/front.jpg',
        backImagePath: 'user/back.jpg',
      }));
    });
  });

  it('submits an ATM withdrawal', async () => {
    renderPage();
    await waitForAccountsLoaded();

    await userEvent.click(screen.getByRole('button', { name: 'Withdraw (ATM)' }));
    fireEvent.keyDown(screen.getByLabelText('Withdrawal amount'), { key: '5' });
    fireEvent.keyDown(screen.getByLabelText('Withdrawal amount'), { key: '0' });
    await userEvent.click(screen.getByRole('button', { name: 'Submit withdrawal' }));

    await waitFor(() => {
      expect(mocks.submitAtmWithdrawal.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
        accountId: 'acct_checking',
        amount: 50,
      }));
    });
  });
});
