import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, DataTable, EmptyState, Field, InlineAlert, PageHeader, StatusChip } from '../../components/ui';
import { accountsService, depositsService, withdrawalsService } from '../../lib/bankingApi';
import { formatCurrency, formatDateTime } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';
import type { DepositUploadTarget } from '../../types/banking';

const ALLOWED_CHECK_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_CHECK_IMAGE_BYTES = 10 * 1024 * 1024;
const MIN_CHECK_IMAGE_BYTES = 1024;
const PENDING_DEPOSIT_STALE_THRESHOLD_MS = 60_000;
const DEPOSIT_STATUS_EVENT_CHANNEL = 'sj-state-bank:deposit-status-events';
const DEPOSIT_STATUS_EVENT_STORAGE_KEY = 'sj-state-bank:deposit-status-events';

type DepositStatusEventPayload = {
  type: 'deposit-status-updated';
  depositId: string;
  status: string;
  at: string;
};

const depositSchema = z.object({
  accountId: z.string().min(1),
  amount: z.number().positive(),
  depositMethod: z.enum(['atm', 'check']),
});

const withdrawSchema = z.object({
  accountId: z.string().min(1),
  amount: z.number().positive(),
});

function formatAmountDigits(digits: string): string {
  const cleaned = digits.replace(/\D/g, '').slice(0, 12);
  if (!cleaned) return '00.00';
  if (cleaned.length === 1) return `${cleaned}0.00`;
  if (cleaned.length === 2) return `${cleaned}.00`;
  if (cleaned.length === 3) return `${cleaned.slice(0, 2)}.${cleaned.slice(2)}0`;
  const integerPart = cleaned.slice(0, -2).replace(/^0+(?=\d)/, '') || '0';
  const centsPart = cleaned.slice(-2);
  return `${integerPart}.${centsPart}`;
}

async function uploadDepositImage(target: DepositUploadTarget, file: File): Promise<void> {
  const response = await fetch(target.signedUrl, {
    method: 'PUT',
    headers: {
      'content-type': file.type || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: file,
  });
  if (!response.ok) {
    throw new Error('Unable to upload check image. Please try again.');
  }
}

function validateCheckImageFile(file: File, side: 'Front' | 'Back'): void {
  const normalizedType = (file.type || '').toLowerCase();
  if (!ALLOWED_CHECK_IMAGE_MIME_TYPES.has(normalizedType)) {
    throw new Error(`${side} check image must be PNG, JPEG, WEBP, HEIC, or HEIF.`);
  }
  if (file.size < MIN_CHECK_IMAGE_BYTES) {
    throw new Error(`${side} check image is too small. Upload a clearer image.`);
  }
  if (file.size > MAX_CHECK_IMAGE_BYTES) {
    throw new Error(`${side} check image exceeds 10MB limit.`);
  }
}

function publishDepositStatusEvent(payload: DepositStatusEventPayload): void {
  if (typeof window === 'undefined') return;
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel(DEPOSIT_STATUS_EVENT_CHANNEL);
    channel.postMessage(payload);
    channel.close();
  }
  try {
    window.localStorage.setItem(DEPOSIT_STATUS_EVENT_STORAGE_KEY, JSON.stringify(payload));
    window.localStorage.removeItem(DEPOSIT_STATUS_EVENT_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

function subscribeDepositStatusEvents(onEvent: (payload: DepositStatusEventPayload) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  let channel: BroadcastChannel | null = null;
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(DEPOSIT_STATUS_EVENT_CHANNEL);
    channel.onmessage = (event: MessageEvent<DepositStatusEventPayload>) => {
      const payload = event.data;
      if (payload?.type === 'deposit-status-updated') onEvent(payload);
    };
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== DEPOSIT_STATUS_EVENT_STORAGE_KEY || !event.newValue) return;
    try {
      const payload = JSON.parse(event.newValue) as DepositStatusEventPayload;
      if (payload?.type === 'deposit-status-updated') onEvent(payload);
    } catch {
      // ignore malformed payload
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('storage', onStorage);
    if (channel) channel.close();
  };
}

export function DepositsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preferredAccountId = searchParams.get('accountId') ?? '';
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [depositAmountDigits, setDepositAmountDigits] = useState('');
  const [withdrawAmountDigits, setWithdrawAmountDigits] = useState('');
  const [depositMethod, setDepositMethod] = useState<'atm' | 'check'>('check');
  const [frontImageFile, setFrontImageFile] = useState<File | null>(null);
  const [backImageFile, setBackImageFile] = useState<File | null>(null);
  const [withdrawSuccessMessage, setWithdrawSuccessMessage] = useState<string | null>(null);
  const [withdrawSuccessMessageFading, setWithdrawSuccessMessageFading] = useState(false);
  const { data: deposits = [] } = useQuery({
    queryKey: queryKeys.deposits(),
    queryFn: depositsService.list,
    refetchInterval: 5_000,
  });
  const { data: accounts = [] } = useQuery({ queryKey: queryKeys.accounts(), queryFn: accountsService.list });
  const withdrawAccounts = useMemo(
    () => accounts.filter((account) => account.status === 'Open' && (account.type === 'Checking' || account.type === 'Savings')),
    [accounts],
  );

  const depositMutation = useMutation({
    mutationFn: async (values: z.infer<typeof depositSchema>) => {
      if (values.depositMethod === 'check') {
        if (!frontImageFile || !backImageFile) {
          throw new Error('Check deposits require front and back images.');
        }
        validateCheckImageFile(frontImageFile, 'Front');
        validateCheckImageFile(backImageFile, 'Back');
        const uploadTargets = await depositsService.createUploadUrls({
          frontFileName: frontImageFile.name,
          backFileName: backImageFile.name,
          frontContentType: frontImageFile.type || 'application/octet-stream',
          backContentType: backImageFile.type || 'application/octet-stream',
          frontFileSizeBytes: frontImageFile.size,
          backFileSizeBytes: backImageFile.size,
        });
        await Promise.all([
          uploadDepositImage(uploadTargets.front, frontImageFile),
          uploadDepositImage(uploadTargets.back, backImageFile),
        ]);

        return depositsService.create({
          accountId: values.accountId,
          amount: values.amount,
          depositMethod: 'check',
          depositType: 'check',
          frontImagePath: uploadTargets.front.path,
          backImagePath: uploadTargets.back.path,
        });
      }

      return depositsService.create({
        accountId: values.accountId,
        amount: values.amount,
        depositMethod: 'atm',
        depositType: 'cash',
      });
    },
    onSuccess: async (created) => {
      setFrontImageFile(null);
      setBackImageFile(null);
      setDepositAmountDigits('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.deposits() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
      ]);
      navigate(`/app/deposits/${created.id}`);
    },
  });

  const withdrawalMutation = useMutation({
    mutationFn: withdrawalsService.submitAtm,
    onSuccess: async (_, variables) => {
      setWithdrawAmountDigits('');
      const sourceAccount = accounts.find((account) => account.id === variables.accountId);
      setWithdrawSuccessMessage(
        `ATM withdrawal of ${formatCurrency(variables.amount)} from ${sourceAccount?.nickname ?? 'your account'} completed.`,
      );
      setWithdrawSuccessMessageFading(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
      ]);
    },
  });

  const depositForm = useForm<z.infer<typeof depositSchema>>({
    resolver: zodResolver(depositSchema),
    defaultValues: {
      accountId: '',
      amount: 0,
      depositMethod: 'check',
    },
  });

  const withdrawForm = useForm<z.infer<typeof withdrawSchema>>({
    resolver: zodResolver(withdrawSchema),
    defaultValues: {
      accountId: '',
      amount: 0,
    },
  });

  const hasDepositAccounts = accounts.length > 0;
  const hasWithdrawalAccounts = withdrawAccounts.length > 0;
  const depositAmountDisplay = formatAmountDigits(depositAmountDigits);
  const withdrawAmountDisplay = formatAmountDigits(withdrawAmountDigits);

  useEffect(() => {
    if (!hasDepositAccounts) return;
    const currentAccountId = depositForm.getValues('accountId');
    const requestedAccountId = accounts.some((account) => account.id === preferredAccountId)
      ? preferredAccountId
      : '';
    if (!currentAccountId || !accounts.some((account) => account.id === currentAccountId)) {
      depositForm.setValue('accountId', requestedAccountId || accounts[0]?.id || '');
    }
  }, [accounts, depositForm, hasDepositAccounts, preferredAccountId]);

  useEffect(() => {
    if (!hasWithdrawalAccounts) return;
    const currentAccountId = withdrawForm.getValues('accountId');
    if (!currentAccountId || !withdrawAccounts.some((account) => account.id === currentAccountId)) {
      withdrawForm.setValue('accountId', withdrawAccounts[0]?.id || '');
    }
  }, [hasWithdrawalAccounts, withdrawAccounts, withdrawForm]);

  useEffect(() => {
    const normalizedAmount = depositAmountDigits ? Number(depositAmountDisplay) : 0;
    depositForm.setValue('amount', normalizedAmount);
  }, [depositAmountDigits, depositAmountDisplay, depositForm]);

  useEffect(() => {
    const normalizedAmount = withdrawAmountDigits ? Number(withdrawAmountDisplay) : 0;
    withdrawForm.setValue('amount', normalizedAmount);
  }, [withdrawAmountDigits, withdrawAmountDisplay, withdrawForm]);

  useEffect(() => {
    if (!withdrawSuccessMessage) return;
    const fadeTimeout = window.setTimeout(() => {
      setWithdrawSuccessMessageFading(true);
    }, 4200);
    const timeout = window.setTimeout(() => {
      setWithdrawSuccessMessage(null);
      setWithdrawSuccessMessageFading(false);
    }, 5000);
    return () => {
      window.clearTimeout(fadeTimeout);
      window.clearTimeout(timeout);
    };
  }, [withdrawSuccessMessage]);

  useEffect(
    () => subscribeDepositStatusEvents(() => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.deposits() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
      ]);
    }),
    [queryClient],
  );

  const rows = deposits.map((deposit) => [
    <Link key={`${deposit.id}-link`} className="text-link" to={`/app/deposits/${deposit.id}`}>
      {deposit.id}
    </Link>,
    accounts.find((account) => account.id === deposit.accountId)?.nickname ?? 'Account unavailable',
    deposit.depositType === 'atm' ? 'ATM' : 'Check',
    formatDateTime(deposit.submittedAt),
    formatCurrency(deposit.amount),
    <StatusChip key={`${deposit.id}-status`} status={deposit.status} />,
  ]);

  return (
    <div className="stack-xl">
      <PageHeader title="Money In/Out" eyebrow="ATM banking" subtitle="Deposit by ATM or check, and withdraw cash from eligible accounts." />

      {withdrawSuccessMessage ? (
        <div
          aria-live="polite"
          className={`floating-toast${withdrawSuccessMessageFading ? ' floating-toast--fade' : ''}`}
          style={{
            position: 'fixed',
            right: 16,
            bottom: 16,
            zIndex: 1200,
            maxWidth: 420,
            width: 'calc(100vw - 32px)',
          }}
        >
          <InlineAlert title="Success" tone="success">
            {withdrawSuccessMessage}
          </InlineAlert>
        </div>
      ) : null}

      <div className="button-row deposits-tab-row">
        <Button onClick={() => setActiveTab('deposit')} type="button" variant={activeTab === 'deposit' ? 'primary' : 'secondary'}>
          Deposit
        </Button>
        <Button onClick={() => setActiveTab('withdraw')} type="button" variant={activeTab === 'withdraw' ? 'primary' : 'secondary'}>
          Withdraw (ATM)
        </Button>
      </div>

      <div className="grid-two">
        {activeTab === 'deposit' ? (
          <Card>
            <form
              className="stack-lg"
              onSubmit={depositForm.handleSubmit(async (values) => {
                if (!hasDepositAccounts) return;
                await depositMutation.mutateAsync(values);
              })}
            >
              <h3>Make a deposit</h3>
              {depositMutation.error instanceof Error ? <p className="muted">{depositMutation.error.message}</p> : null}
              <Field label="Deposit into" error={depositForm.formState.errors.accountId?.message}>
                <select {...depositForm.register('accountId')} disabled={!hasDepositAccounts}>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.nickname} ({account.maskedNumber})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Deposit method" error={depositForm.formState.errors.depositMethod?.message}>
                <select
                  disabled={!hasDepositAccounts}
                  onChange={(event) => {
                    const next = event.target.value as 'atm' | 'check';
                    setDepositMethod(next);
                    if (next === 'atm') {
                      setFrontImageFile(null);
                      setBackImageFile(null);
                    }
                    depositForm.setValue('depositMethod', next, { shouldValidate: true });
                  }}
                  value={depositMethod}
                >
                  <option value="check">Check</option>
                  <option value="atm">ATM</option>
                </select>
              </Field>
              <Field label="Amount" error={depositForm.formState.errors.amount?.message}>
                <input
                  aria-label="Deposit amount"
                  disabled={!hasDepositAccounts}
                  inputMode="numeric"
                  name="amount"
                  onFocus={(event) => {
                    event.currentTarget.setSelectionRange(0, event.currentTarget.value.length);
                  }}
                  onKeyDown={(event) => {
                    if (event.key >= '0' && event.key <= '9') {
                      event.preventDefault();
                      setDepositAmountDigits((prev) => `${prev}${event.key}`.slice(0, 12));
                      return;
                    }
                    if (event.key === 'Backspace') {
                      event.preventDefault();
                      setDepositAmountDigits((prev) => prev.slice(0, -1));
                      return;
                    }
                    if (event.key === 'Delete') {
                      event.preventDefault();
                      setDepositAmountDigits('');
                      return;
                    }
                    const allowedKeys = ['Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'];
                    if (allowedKeys.includes(event.key)) return;
                    event.preventDefault();
                  }}
                  onPaste={(event) => {
                    event.preventDefault();
                    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 12);
                    setDepositAmountDigits(pasted);
                  }}
                  type="text"
                  value={`$${depositAmountDisplay}`}
                />
              </Field>

              {depositMethod === 'check' ? (
                <>
                  <Field label="Front of check">
                    <label className="file-upload">
                      <input
                        accept="image/*"
                        className="file-upload__input"
                        disabled={!hasDepositAccounts}
                        onChange={(event) => setFrontImageFile(event.target.files?.[0] ?? null)}
                        type="file"
                      />
                      <span className="file-upload__button">Choose file</span>
                      <span className="file-upload__name">{frontImageFile?.name ?? 'No file selected'}</span>
                    </label>
                  </Field>
                  <Field label="Back of check">
                    <label className="file-upload">
                      <input
                        accept="image/*"
                        className="file-upload__input"
                        disabled={!hasDepositAccounts}
                        onChange={(event) => setBackImageFile(event.target.files?.[0] ?? null)}
                        type="file"
                      />
                      <span className="file-upload__button">Choose file</span>
                      <span className="file-upload__name">{backImageFile?.name ?? 'No file selected'}</span>
                    </label>
                  </Field>
                </>
              ) : null}

              {!hasDepositAccounts ? (
                <EmptyState
                  title="Deposits need an account"
                  description="Open an account before submitting a deposit."
                  action={<Link className="button button--secondary" to="/app/accounts">Open account</Link>}
                />
              ) : null}

              <Button disabled={!hasDepositAccounts || depositMutation.isPending} type="submit">
                {depositMutation.isPending ? 'Submitting deposit...' : 'Submit deposit'}
              </Button>
            </form>
          </Card>
        ) : (
          <Card>
            <form
              className="stack-lg"
              onSubmit={withdrawForm.handleSubmit(async (values) => {
                if (!hasWithdrawalAccounts) return;
                await withdrawalMutation.mutateAsync(values);
              })}
            >
              <h3>ATM withdrawal</h3>
              {withdrawalMutation.error instanceof Error ? <p className="muted">{withdrawalMutation.error.message}</p> : null}
              <Field label="Withdraw from" error={withdrawForm.formState.errors.accountId?.message}>
                <select {...withdrawForm.register('accountId')} disabled={!hasWithdrawalAccounts}>
                  {withdrawAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.nickname} ({account.maskedNumber})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Amount" error={withdrawForm.formState.errors.amount?.message}>
                <input
                  aria-label="Withdrawal amount"
                  disabled={!hasWithdrawalAccounts}
                  inputMode="numeric"
                  name="withdrawAmount"
                  onFocus={(event) => {
                    event.currentTarget.setSelectionRange(0, event.currentTarget.value.length);
                  }}
                  onKeyDown={(event) => {
                    if (event.key >= '0' && event.key <= '9') {
                      event.preventDefault();
                      setWithdrawAmountDigits((prev) => `${prev}${event.key}`.slice(0, 12));
                      return;
                    }
                    if (event.key === 'Backspace') {
                      event.preventDefault();
                      setWithdrawAmountDigits((prev) => prev.slice(0, -1));
                      return;
                    }
                    if (event.key === 'Delete') {
                      event.preventDefault();
                      setWithdrawAmountDigits('');
                      return;
                    }
                    const allowedKeys = ['Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'];
                    if (allowedKeys.includes(event.key)) return;
                    event.preventDefault();
                  }}
                  onPaste={(event) => {
                    event.preventDefault();
                    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 12);
                    setWithdrawAmountDigits(pasted);
                  }}
                  type="text"
                  value={`$${withdrawAmountDisplay}`}
                />
              </Field>

              {!hasWithdrawalAccounts ? (
                <EmptyState
                  title="Eligible account required"
                  description="Open a checking or savings account before making ATM withdrawals."
                  action={<Link className="button button--secondary" to="/app/accounts">Open account</Link>}
                />
              ) : null}

              <Button disabled={!hasWithdrawalAccounts || withdrawalMutation.isPending} type="submit">
                {withdrawalMutation.isPending ? 'Submitting withdrawal...' : 'Submit withdrawal'}
              </Button>
            </form>
          </Card>
        )}

        <Card>
          <h3>{activeTab === 'deposit' ? 'Deposit requirements' : 'Withdrawal requirements'}</h3>
          {activeTab === 'deposit' ? (
            <ol className="plain-list">
              <li>Select destination account.</li>
              <li>Choose method: ATM or check.</li>
              <li>For check deposits, upload front and back images.</li>
              <li>Check deposits post after review; ATM deposits post immediately.</li>
            </ol>
          ) : (
            <ol className="plain-list">
              <li>Withdrawals are ATM only.</li>
              <li>Checking and savings accounts are eligible.</li>
              <li>Insufficient available balance blocks submission.</li>
            </ol>
          )}
        </Card>
      </div>

      {rows.length ? (
        <Card>
          <h3>Recent deposits</h3>
          <DataTable headers={['Reference', 'Account', 'Method', 'Submitted', 'Amount', 'Status']} rows={rows} />
        </Card>
      ) : (
        <EmptyState
          title="No deposits yet"
          description="Submitted ATM and check deposits appear here."
        />
      )}
    </div>
  );
}

export function DepositDetailPage() {
  const { depositId = '' } = useParams();
  const queryClient = useQueryClient();
  const lastDepositStatusRef = useRef<string | null>(null);
  const { data: deposit, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['deposit', depositId],
    queryFn: () => depositsService.get(depositId),
    enabled: Boolean(depositId),
    refetchInterval: (query) => (query.state.data?.status === 'PENDING_REVIEW' ? 2_000 : false),
  });
  const { data: accounts = [] } = useQuery({ queryKey: queryKeys.accounts(), queryFn: accountsService.list });

  useEffect(() => {
    if (!deposit) return;
    const previousStatus = lastDepositStatusRef.current;
    if (previousStatus && previousStatus !== deposit.status) {
      publishDepositStatusEvent({
        type: 'deposit-status-updated',
        depositId: deposit.id,
        status: deposit.status,
        at: new Date().toISOString(),
      });
    }
    if (previousStatus === 'PENDING_REVIEW' && deposit.status !== 'PENDING_REVIEW') {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.deposits() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
      ]);
    }
    lastDepositStatusRef.current = deposit.status;
  }, [deposit, queryClient]);

  useEffect(
    () => subscribeDepositStatusEvents((payload) => {
      if (payload.depositId !== depositId) return;
      void refetch();
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.deposits() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
      ]);
    }),
    [depositId, queryClient, refetch],
  );

  if (!deposit) {
    return <EmptyState title="Deposit not found" description="The requested deposit could not be located. Please return to your deposit history and try again." />;
  }

  const accountName = accounts.find((account) => account.id === deposit.accountId)?.nickname ?? 'Account unavailable';
  const submittedAtMs = Number.isNaN(Date.parse(deposit.submittedAt)) ? null : Date.parse(deposit.submittedAt);
  const checkDepositRunningLate = deposit.depositType === 'check'
    && deposit.status === 'PENDING_REVIEW'
    && submittedAtMs !== null
    && (dataUpdatedAt - submittedAtMs) > PENDING_DEPOSIT_STALE_THRESHOLD_MS;

  return (
    <div className="stack-xl">
      <PageHeader title={`Deposit ${deposit.id}`} eyebrow="Deposit tracking" subtitle="Review account, method, amount, and status for this deposit." />
      {deposit.status === 'DECLINED' ? (
        <InlineAlert title="Deposit declined" tone="warning">
          {deposit.note || 'This check deposit was declined. Please re-submit with clear check images.'}
        </InlineAlert>
      ) : null}
      {checkDepositRunningLate ? (
        <InlineAlert title="Deposit still pending" tone="warning">
          Review is taking longer than expected. Keep this page open; it auto-refreshes and updates when settlement completes.
        </InlineAlert>
      ) : null}
      <div className="grid-two">
        <Card>
          <dl className="stat-list">
            <div>
              <dt>Account</dt>
              <dd>{accountName}</dd>
            </div>
            <div>
              <dt>Method</dt>
              <dd>{deposit.depositType === 'atm' ? 'ATM' : 'Check'}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{formatCurrency(deposit.amount)}</dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>{formatDateTime(deposit.submittedAt)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd><StatusChip status={deposit.status} /></dd>
            </div>
          </dl>
        </Card>
        <Card>
          <h3>Deposit summary</h3>
          <div className="timeline">
            <div className="timeline__item timeline__item--complete">Deposit submitted</div>
            <div className="timeline__item timeline__item--current">Review / settlement</div>
            <div className="timeline__item">Recorded in history</div>
          </div>
          {deposit.depositType === 'check' && deposit.status === 'PENDING_REVIEW' ? (
            <p className="muted">Check deposit pending. This page auto-refreshes every 2 seconds.</p>
          ) : null}
          <p className="muted">{deposit.note}</p>
        </Card>
      </div>
    </div>
  );
}
