import { describe, expect, it } from 'vitest';
import { normalizeAccount, normalizeTransaction, normalizeTransferResult } from './bankingContract';

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
});
