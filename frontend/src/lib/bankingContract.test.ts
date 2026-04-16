import { describe, expect, it } from 'vitest';
import {
  normalizeAccount,
  normalizeTransaction,
  normalizeTransferPlan,
  normalizeTransferResult,
  normalizeTransferSubmissionResult,
} from './bankingContract';

describe('banking contract normalization', () => {
  it('normalizes /api account payloads without changing UI shape', () => {
    const account = normalizeAccount({
      id: 'acct_1',
      nickname: 'Everyday Checking',
      type: 'Checking',
      maskedNumber: '•••• 1234',
      status: 'Open',
      routingNumber: '121000358',
      openedAt: '2026-01-02T00:00:00Z',
      closeEligible: true,
      canClose: true,
      closeReasons: [],
      balances: {
        availableBalance: 1200.55,
        currentBalance: 1180.55,
      },
    });

    expect(account.type).toBe('Checking');
    expect(account.balances.availableBalance).toBe(1200.55);
    expect(account.routingNumber).toBe('121000358');
    expect(account.canClose).toBe(true);
  });

  it('normalizes raw ledger account payloads to UI model', () => {
    const account = normalizeAccount({
      id: 'acct_2',
      nickname: 'Rainy Day',
      account_type: 'savings',
      account_last4: '9876',
      status: 'open',
      routing_number: null,
      available_balance_cents: 50025,
      current_balance_cents: 50025,
      close_eligible: false,
      opened_at: '2026-03-01T00:00:00Z',
    });

    expect(account.type).toBe('Savings');
    expect(account.maskedNumber).toBe('•••• 9876');
    expect(account.routingNumber).toBe('N/A');
    expect(account.balances.currentBalance).toBe(500.25);
    expect(account.canClose).toBe(false);
  });

  it('normalizes transactions and transfer results with status/type casing drift', () => {
    const transaction = normalizeTransaction({
      id: 'txn_1',
      account_id: 'acct_1',
      type: 'bill_payment',
      direction: 'in',
      amount_cents: 2599,
      status: 'posted',
      description: '',
      posted_at: '2026-03-05T00:00:00Z',
    });

    const transfer = normalizeTransferResult({
      id: 'tr_1',
      status: 'completed',
      submitted_at: '2026-03-05T00:00:00Z',
    });

    expect(transaction.type).toBe('Bill Pay');
    expect(transaction.status).toBe('COMPLETED');
    expect(transaction.amount).toBe(25.99);
    expect(transaction.direction).toBe('credit');
    expect(transfer.status).toBe('COMPLETED');
  });

  it('normalizes scheduled transfer plan payloads from /api responses', () => {
    const plan = normalizeTransferPlan({
      id: 'plan_1',
      from_account_id: 'acct_1',
      to_account_id: 'acct_2',
      amount_cents: 12500,
      cadence: 'biweekly',
      start_date: '2026-05-01',
      run_time: '09:30:00',
      timezone: 'America/New_York',
      status: 'scheduled',
      next_run_at: '2026-05-01T13:30:00Z',
      created_at: '2026-04-15T00:00:00Z',
      updated_at: '2026-04-15T00:00:00Z',
    });

    expect(plan.amount).toBe(125);
    expect(plan.cadence).toBe('Biweekly');
    expect(plan.runTime).toBe('09:30');
    expect(plan.status).toBe('SCHEDULED');
  });

  it('normalizes transfer submission result for scheduled mode', () => {
    const result = normalizeTransferSubmissionResult({
      mode: 'SCHEDULED',
      plan: {
        id: 'plan_2',
        from_account_id: 'acct_1',
        to_account_id: 'acct_2',
        amount_cents: 5000,
        cadence: 'monthly',
        start_date: '2026-05-10',
        run_time: '07:15:00',
        timezone: 'America/Los_Angeles',
        status: 'processing',
        created_at: '2026-04-15T00:00:00Z',
        updated_at: '2026-04-15T00:00:00Z',
      },
    });

    expect(result.mode).toBe('SCHEDULED');
    expect(result.plan?.cadence).toBe('Monthly');
    expect(result.plan?.status).toBe('PROCESSING');
  });
});
