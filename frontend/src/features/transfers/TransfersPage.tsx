import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Dialog, EmptyState, Field, InlineAlert, PageHeader, StatusChip } from '../../components/ui';
import {
  accountsService,
  externalAccountsService,
  externalTransfersService,
  memberTransfersService,
  profileService,
  transfersService,
} from '../../lib/bankingApi';
import { formatCurrency, formatDate } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';
import type {
  ExternalAccount,
  MemberTransferRecipient,
  TransferCadence,
  TransferScheduleMode,
} from '../../types/banking';

type TransferMode = 'SELF' | 'MEMBER' | 'EXTERNAL';
type CommonBank = { id: string; name: string; logoSrc: string };

type ReviewState =
  | { kind: 'SELF'; payload: { fromAccountId: string; toAccountId: string; amount: number; memo?: string; transferDate: string } }
  | { kind: 'MEMBER'; payload: { fromAccountId: string; recipientEmail: string; amount: number; memo?: string; scheduleMode: TransferScheduleMode; transferDate?: string; cadence?: TransferCadence; startDate?: string; runTime?: string; endDate?: string; timezone?: string }; recipient: MemberTransferRecipient }
  | { kind: 'EXTERNAL'; payload: { fromAccountId: string; externalAccountId: string; amount: number; memo?: string; scheduleMode: TransferScheduleMode; transferDate?: string; cadence?: TransferCadence; startDate?: string; runTime?: string; endDate?: string; timezone?: string }; externalAccount?: ExternalAccount };

const CADENCE_OPTIONS: TransferCadence[] = ['Once', 'Daily', 'Weekly', 'Biweekly', 'Monthly'];
const TRANSFER_LIVE_REFRESH_MS = 10_000;
const COMMON_BANKS: CommonBank[] = [
  { id: 'chase', name: 'Chase', logoSrc: '/banks/chase.png' },
  { id: 'bank_of_america', name: 'Bank of America', logoSrc: '/banks/bank-of-america.png' },
  { id: 'wells_fargo', name: 'Wells Fargo', logoSrc: '/banks/wells-fargo.png' },
  { id: 'citi', name: 'Citi', logoSrc: '/banks/citi.png' },
  { id: 'us_bank', name: 'U.S. Bank', logoSrc: '/banks/us-bank.png' },
  { id: 'capital_one', name: 'Capital One', logoSrc: '/banks/capital-one.png' },
  { id: 'pnc', name: 'PNC Bank', logoSrc: '/banks/pnc.png' },
  { id: 'goldman_sachs', name: 'Goldman Sachs', logoSrc: '/banks/goldman-sachs.png' },
  { id: 'truist', name: 'Truist', logoSrc: '/banks/truist.svg' },
  { id: 'td_bank', name: 'TD Bank', logoSrc: '/banks/td-bank.png' },
];

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

function getBrowserTimezone(): string {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timezone === 'string' && timezone.trim() ? timezone : 'UTC';
  } catch {
    return 'UTC';
  }
}

function getLocalToday(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  const normalized = normalizeEmail(value);
  if (!normalized || normalized.startsWith('@') || normalized.endsWith('@')) return false;
  const [local, domain] = normalized.split('@');
  return Boolean(local && domain && domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.'));
}

function AmountInput({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: Dispatch<SetStateAction<string>>;
}) {
  return (
    <input
      aria-label="Amount"
      disabled={disabled}
      inputMode="numeric"
      name="amount"
      onFocus={(event) => {
        event.currentTarget.setSelectionRange(0, event.currentTarget.value.length);
      }}
      onKeyDown={(event) => {
        if (event.key >= '0' && event.key <= '9') {
          event.preventDefault();
          onChange((current) => `${current}${event.key}`.slice(0, 12));
          return;
        }
        if (event.key === 'Backspace') {
          event.preventDefault();
          onChange((current) => current.slice(0, -1));
          return;
        }
        if (event.key === 'Delete') {
          event.preventDefault();
          onChange(() => '');
          return;
        }
        if (['Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
        event.preventDefault();
      }}
      onChange={() => {}}
      onPaste={(event) => {
        event.preventDefault();
        onChange(() => event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 12));
      }}
      type="text"
      value={`$${formatAmountDigits(value)}`}
    />
  );
}

function scheduleSummary(plan: { cadence: string; nextRunAt?: string; lastFailureReason?: string }) {
  if (!plan.nextRunAt) return plan.lastFailureReason || 'No next run scheduled.';
  return `${plan.cadence} • Next run ${formatDate(plan.nextRunAt)}`;
}

function sanitizeDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function findCommonBankByName(bankName: string): CommonBank | undefined {
  const normalized = bankName.trim().toLowerCase();
  return COMMON_BANKS.find((bank) => bank.name.toLowerCase() === normalized);
}

export function TransfersPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const preferredFromAccountId = searchParams.get('fromAccountId') ?? '';
  const today = getLocalToday();
  const browserTimezone = getBrowserTimezone();
  const [mode, setMode] = useState<TransferMode>('SELF');
  const [review, setReview] = useState<ReviewState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [memberRecipient, setMemberRecipient] = useState<MemberTransferRecipient | null>(null);
  const [planPendingCancel, setPlanPendingCancel] = useState<{ kind: 'MEMBER' | 'EXTERNAL'; id: string; label: string } | null>(null);
  const [isExternalAccountDialogOpen, setIsExternalAccountDialogOpen] = useState(false);
  const [selfAmountDigits, setSelfAmountDigits] = useState('');
  const [memberAmountDigits, setMemberAmountDigits] = useState('');
  const [externalAmountDigits, setExternalAmountDigits] = useState('');
  const [externalLinkForm, setExternalLinkForm] = useState({
    bankId: COMMON_BANKS[0]?.id ?? '',
    accountType: 'Checking' as ExternalAccount['accountType'],
    routingNumber: '',
    accountNumber: '',
    confirmAccountNumber: '',
  });

  const [selfForm, setSelfForm] = useState({
    fromAccountId: '',
    toAccountId: '',
    memo: '',
    transferDate: today,
  });
  const [memberForm, setMemberForm] = useState({
    fromAccountId: '',
    recipientEmail: '',
    memo: '',
    transferDate: today,
    scheduleMode: 'NOW' as TransferScheduleMode,
    cadence: 'Once' as TransferCadence,
    startDate: today,
    runTime: '09:00',
    endDate: '',
    timezone: '',
  });
  const [externalForm, setExternalForm] = useState({
    fromAccountId: '',
    externalAccountId: '',
    memo: '',
    transferDate: today,
    scheduleMode: 'NOW' as TransferScheduleMode,
    cadence: 'Once' as TransferCadence,
    startDate: today,
    runTime: '09:00',
    endDate: '',
    timezone: '',
  });

  const { data: accounts = [] } = useQuery({ queryKey: queryKeys.accounts(), queryFn: accountsService.list });
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: profileService.get });
  const { data: memberPlans = [] } = useQuery({
    queryKey: queryKeys.memberTransferPlans(),
    queryFn: memberTransfersService.listPlans,
    refetchInterval: TRANSFER_LIVE_REFRESH_MS,
  });
  const { data: externalAccounts = [] } = useQuery({ queryKey: queryKeys.externalAccounts(), queryFn: externalAccountsService.list });
  const { data: externalPlans = [] } = useQuery({
    queryKey: queryKeys.externalTransferPlans(),
    queryFn: externalTransfersService.listPlans,
    refetchInterval: TRANSFER_LIVE_REFRESH_MS,
  });
  const { data: externalTransfers = [] } = useQuery({
    queryKey: queryKeys.externalTransfers(),
    queryFn: externalTransfersService.list,
    refetchInterval: TRANSFER_LIVE_REFRESH_MS,
  });

  const checkingAccounts = useMemo(
    () => accounts.filter((account) => account.type === 'Checking' && account.status === 'Open'),
    [accounts],
  );
  const preferredSelfFromAccountId = accounts.find((account) => account.id === preferredFromAccountId)?.id || accounts[0]?.id || '';
  const selfFromAccountId = selfForm.fromAccountId || preferredSelfFromAccountId;
  const selfToAccountOptions = useMemo(
    () => accounts.filter((account) => account.id !== selfFromAccountId),
    [accounts, selfFromAccountId],
  );
  const selfToAccountId = selfForm.toAccountId && selfForm.toAccountId !== selfFromAccountId
    ? selfForm.toAccountId
    : selfToAccountOptions[0]?.id || '';
  const firstCheckingAccountId = checkingAccounts[0]?.id || '';
  const memberFromAccountId = memberForm.fromAccountId || firstCheckingAccountId;
  const memberTimezone = memberForm.timezone || profile?.timezone || browserTimezone;
  const externalFromAccountId = externalForm.fromAccountId || firstCheckingAccountId;
  const selectedExternalAccountId = externalForm.externalAccountId || externalAccounts[0]?.id || '';
  const selectedExternalAccount = externalAccounts.find((account) => account.id === selectedExternalAccountId);
  const selectedLinkedBank = selectedExternalAccount ? findCommonBankByName(selectedExternalAccount.bankName) : undefined;
  const selectedBankForLink = COMMON_BANKS.find((bank) => bank.id === externalLinkForm.bankId);
  const externalTimezone = externalForm.timezone || profile?.timezone || browserTimezone;
  const memberActivePlans = memberPlans.filter((plan) => plan.status === 'SCHEDULED' || plan.status === 'PROCESSING');
  const externalActivePlans = externalPlans.filter((plan) => plan.status === 'SCHEDULED' || plan.status === 'PROCESSING');
  const scheduledTransfers = useMemo(
    () => [
      ...memberActivePlans.map((plan) => ({
        id: plan.id,
        kind: 'MEMBER' as const,
        title: plan.recipientDisplayName,
        amount: plan.amount,
        summary: scheduleSummary(plan),
        status: plan.status,
        cancelLabel: `Cancel ${plan.recipientDisplayName} transfer?`,
      })),
      ...externalActivePlans.map((plan) => ({
        id: plan.id,
        kind: 'EXTERNAL' as const,
        title: plan.externalAccountLabel,
        amount: plan.amount,
        summary: scheduleSummary(plan),
        status: plan.status,
        cancelLabel: `Cancel ${plan.externalAccountLabel} transfer?`,
      })),
    ],
    [memberActivePlans, externalActivePlans],
  );

  const invalidateTransferQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.memberTransferPlans() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.externalAccounts() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.externalTransferPlans() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.externalTransfers() }),
    ]);
  };

  const selfSubmitMutation = useMutation({
    mutationFn: transfersService.submit,
    onSuccess: async () => {
      await invalidateTransferQueries();
      setSuccessMessage('Transfer submitted');
      setErrorMessage(null);
      setReview(null);
      setSelfAmountDigits('');
      setSelfForm((current) => ({ ...current, memo: '' }));
    },
    onError: (error: Error) => {
      setErrorMessage(error.message);
      setSuccessMessage(null);
    },
  });

  const resolveRecipientMutation = useMutation({
    mutationFn: memberTransfersService.resolveRecipient,
    onSuccess: (recipient) => {
      setMemberRecipient(recipient);
      setErrorMessage(null);
    },
    onError: (error: Error) => {
      setMemberRecipient(null);
      setErrorMessage(error.message);
    },
  });

  const memberSubmitMutation = useMutation({
    mutationFn: memberTransfersService.submit,
    onSuccess: async (result) => {
      await invalidateTransferQueries();
      setSuccessMessage(result.mode === 'SCHEDULED' ? 'Scheduled member transfer created' : 'Member transfer submitted');
      setErrorMessage(null);
      setReview(null);
      setMemberAmountDigits('');
      setMemberForm((current) => ({ ...current, memo: '', recipientEmail: current.recipientEmail }));
    },
    onError: (error: Error) => {
      setErrorMessage(error.message);
      setSuccessMessage(null);
    },
  });

  const externalAccountCreateMutation = useMutation({
    mutationFn: externalAccountsService.create,
    onSuccess: async (createdAccount) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.externalAccounts() });
      setExternalForm((current) => ({
        ...current,
        externalAccountId: createdAccount.id,
      }));
      setExternalLinkForm({
        bankId: COMMON_BANKS[0]?.id ?? '',
        accountType: 'Checking',
        routingNumber: '',
        accountNumber: '',
        confirmAccountNumber: '',
      });
      setSuccessMessage('External account linked');
      setErrorMessage(null);
      setIsExternalAccountDialogOpen(false);
    },
    onError: (error: Error) => {
      setErrorMessage(error.message);
      setSuccessMessage(null);
    },
  });

  const handleExternalAccountCreate = async () => {
    const selectedBank = COMMON_BANKS.find((bank) => bank.id === externalLinkForm.bankId);
    if (!selectedBank) {
      throw new Error('Choose a bank.');
    }
    const routingNumber = sanitizeDigits(externalLinkForm.routingNumber);
    const accountNumber = sanitizeDigits(externalLinkForm.accountNumber);
    const confirmAccountNumber = sanitizeDigits(externalLinkForm.confirmAccountNumber);
    if (routingNumber.length !== 9) {
      throw new Error('Routing number must be 9 digits.');
    }
    if (accountNumber.length < 4 || accountNumber.length > 17) {
      throw new Error('Account number must be between 4 and 17 digits.');
    }
    if (accountNumber !== confirmAccountNumber) {
      throw new Error('Account numbers do not match.');
    }
    await externalAccountCreateMutation.mutateAsync({
      bankName: selectedBank.name,
      nickname: selectedBank.name,
      accountType: externalLinkForm.accountType,
      routingNumber,
      accountNumber,
      confirmAccountNumber,
    });
  };

  const externalSubmitMutation = useMutation({
    mutationFn: externalTransfersService.submit,
    onSuccess: async (result) => {
      await invalidateTransferQueries();
      setSuccessMessage(result.mode === 'SCHEDULED' ? 'Scheduled external transfer created' : 'External transfer submitted');
      setErrorMessage(null);
      setReview(null);
      setExternalAmountDigits('');
      setExternalForm((current) => ({ ...current, memo: '' }));
    },
    onError: (error: Error) => {
      setErrorMessage(error.message);
      setSuccessMessage(null);
    },
  });

  const cancelMemberPlanMutation = useMutation({
    mutationFn: memberTransfersService.cancelPlan,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.memberTransferPlans() });
      setPlanPendingCancel(null);
      setSuccessMessage('Scheduled member transfer cancelled');
      setErrorMessage(null);
    },
  });

  const cancelExternalPlanMutation = useMutation({
    mutationFn: externalTransfersService.cancelPlan,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.externalTransferPlans() });
      setPlanPendingCancel(null);
      setSuccessMessage('Scheduled external transfer cancelled');
      setErrorMessage(null);
    },
  });

  const validateSchedule = (scheduleMode: TransferScheduleMode, startDate: string, runTime: string, endDate: string, timezoneName: string) => {
    if (scheduleMode !== 'SCHEDULED') return;
    if (!startDate || !runTime) throw new Error('Start date and run time are required.');
    const now = new Date();
    const scheduled = new Date(`${startDate}T${runTime}:00`);
    if (Number.isNaN(scheduled.getTime()) || scheduled < now) {
      throw new Error('Scheduled transfers must be in the future.');
    }
    if (endDate && endDate < startDate) {
      throw new Error('End date must be on or after start date.');
    }
    if (!timezoneName) {
      throw new Error('Timezone is required.');
    }
  };

  const buildAmount = (digits: string) => Number(formatAmountDigits(digits));

  const openSelfReview = () => {
    const amount = buildAmount(selfAmountDigits);
    if (accounts.length < 2) throw new Error('You need at least two accounts to transfer between your own accounts.');
    if (!selfFromAccountId || !selfToAccountId) throw new Error('Choose both accounts.');
    if (selfFromAccountId === selfToAccountId) throw new Error('Choose two different accounts.');
    if (amount <= 0) throw new Error('Enter an amount greater than zero.');
    setReview({
      kind: 'SELF',
      payload: {
        fromAccountId: selfFromAccountId,
        toAccountId: selfToAccountId,
        amount,
        memo: selfForm.memo || undefined,
        transferDate: selfForm.transferDate,
      },
    });
  };

  const openMemberReview = async () => {
    const amount = buildAmount(memberAmountDigits);
    if (!checkingAccounts.length) throw new Error('A checking account is required for member transfers.');
    if (!memberFromAccountId) throw new Error('Choose a funding account.');
    const normalizedRecipientEmail = normalizeEmail(memberForm.recipientEmail);
    if (!normalizedRecipientEmail) throw new Error('Recipient email is required.');
    if (!isValidEmail(normalizedRecipientEmail)) throw new Error('Recipient email must be a valid email address.');
    if (amount <= 0) throw new Error('Enter an amount greater than zero.');
    validateSchedule(memberForm.scheduleMode, memberForm.startDate, memberForm.runTime, memberForm.endDate, memberTimezone);
    const resolvedRecipient = memberRecipient && normalizeEmail(memberRecipient.email) === normalizedRecipientEmail
      ? memberRecipient
      : await resolveRecipientMutation.mutateAsync(normalizedRecipientEmail);
    setMemberRecipient(resolvedRecipient);
    setReview({
      kind: 'MEMBER',
      payload: {
        fromAccountId: memberFromAccountId,
        recipientEmail: normalizedRecipientEmail,
        amount,
        memo: memberForm.memo || undefined,
        scheduleMode: memberForm.scheduleMode,
        transferDate: memberForm.scheduleMode === 'NOW' ? memberForm.transferDate : undefined,
        cadence: memberForm.scheduleMode === 'SCHEDULED' ? memberForm.cadence : undefined,
        startDate: memberForm.scheduleMode === 'SCHEDULED' ? memberForm.startDate : undefined,
        runTime: memberForm.scheduleMode === 'SCHEDULED' ? memberForm.runTime : undefined,
        endDate: memberForm.scheduleMode === 'SCHEDULED' && memberForm.endDate ? memberForm.endDate : undefined,
        timezone: memberTimezone,
      },
      recipient: resolvedRecipient,
    });
  };

  const openExternalReview = () => {
    const amount = buildAmount(externalAmountDigits);
    if (!checkingAccounts.length) throw new Error('A checking account is required for external transfers.');
    if (!externalFromAccountId || !selectedExternalAccountId) throw new Error('Choose both accounts.');
    if (amount <= 0) throw new Error('Enter an amount greater than zero.');
    validateSchedule(externalForm.scheduleMode, externalForm.startDate, externalForm.runTime, externalForm.endDate, externalTimezone);
    setReview({
      kind: 'EXTERNAL',
      payload: {
        fromAccountId: externalFromAccountId,
        externalAccountId: selectedExternalAccountId,
        amount,
        memo: externalForm.memo || undefined,
        scheduleMode: externalForm.scheduleMode,
        transferDate: externalForm.scheduleMode === 'NOW' ? externalForm.transferDate : undefined,
        cadence: externalForm.scheduleMode === 'SCHEDULED' ? externalForm.cadence : undefined,
        startDate: externalForm.scheduleMode === 'SCHEDULED' ? externalForm.startDate : undefined,
        runTime: externalForm.scheduleMode === 'SCHEDULED' ? externalForm.runTime : undefined,
        endDate: externalForm.scheduleMode === 'SCHEDULED' && externalForm.endDate ? externalForm.endDate : undefined,
        timezone: externalTimezone,
      },
      externalAccount: externalAccounts.find((account) => account.id === selectedExternalAccountId),
    });
  };

  const handleReviewOpen = async () => {
    setErrorMessage(null);
    try {
      if (mode === 'SELF') {
        openSelfReview();
        return;
      }
      if (mode === 'MEMBER') {
        await openMemberReview();
        return;
      }
      openExternalReview();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to review transfer.');
    }
  };

  const reviewTitle = review?.kind === 'SELF'
    ? 'Review self transfer'
    : review?.kind === 'MEMBER'
      ? review.payload.scheduleMode === 'SCHEDULED' ? 'Review scheduled member transfer' : 'Review member transfer'
      : review?.payload.scheduleMode === 'SCHEDULED'
        ? 'Review scheduled external transfer'
        : 'Review external transfer';
  const reviewSubmitPending = selfSubmitMutation.isPending || memberSubmitMutation.isPending || externalSubmitMutation.isPending;

  useEffect(() => {
    if (!successMessage) return;
    const timeout = window.setTimeout(() => {
      setSuccessMessage(null);
    }, 10_000);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  return (
    <div className="stack-xl">
      <PageHeader
        title="Transfers"
        eyebrow="Move money"
        subtitle="Transfer between your accounts, to another SJ State Bank member, or to a linked external bank."
      />

      {successMessage ? (
        <div
          aria-live="polite"
          className="floating-toast"
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
            {successMessage}
          </InlineAlert>
        </div>
      ) : null}
      {errorMessage ? (
        <InlineAlert title="Unable to continue" tone="warning">
          {errorMessage}
        </InlineAlert>
      ) : null}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Button onClick={() => setMode('SELF')} type="button" variant={mode === 'SELF' ? 'primary' : 'secondary'}>My accounts</Button>
        <Button onClick={() => setMode('MEMBER')} type="button" variant={mode === 'MEMBER' ? 'primary' : 'secondary'}>Another SJ State user</Button>
        <Button onClick={() => setMode('EXTERNAL')} type="button" variant={mode === 'EXTERNAL' ? 'primary' : 'secondary'}>External bank</Button>
      </div>

      <div className="grid-two">
        <Card>
          {mode === 'SELF' ? (
            <div className="stack-lg">
              <Field label="From account">
                <select aria-label="From account" onChange={(event) => setSelfForm((current) => ({ ...current, fromAccountId: event.target.value }))} value={selfFromAccountId}>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.nickname} ({account.maskedNumber})</option>
                  ))}
                </select>
              </Field>
              <Field label="To account">
                <select aria-label="To account" onChange={(event) => setSelfForm((current) => ({ ...current, toAccountId: event.target.value }))} value={selfToAccountId}>
                  {selfToAccountOptions.map((account) => (
                    <option key={account.id} value={account.id}>{account.nickname} ({account.maskedNumber})</option>
                  ))}
                </select>
              </Field>
              <Field label="Amount">
                <AmountInput disabled={accounts.length < 2} onChange={setSelfAmountDigits} value={selfAmountDigits} />
              </Field>
              <Field label="Memo">
                <input aria-label="Memo" onChange={(event) => setSelfForm((current) => ({ ...current, memo: event.target.value }))} value={selfForm.memo} />
              </Field>
              <Field label="Transfer date">
                <input aria-label="Transfer date" onChange={(event) => setSelfForm((current) => ({ ...current, transferDate: event.target.value }))} type="date" value={selfForm.transferDate} />
              </Field>
              <Button onClick={handleReviewOpen} type="button">Review transfer</Button>
            </div>
          ) : null}

          {mode === 'MEMBER' ? (
            checkingAccounts.length ? (
              <div className="stack-lg">
                <Field label="Funding account">
                  <select aria-label="Funding account" onChange={(event) => setMemberForm((current) => ({ ...current, fromAccountId: event.target.value }))} value={memberFromAccountId}>
                    {checkingAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.nickname} ({account.maskedNumber}){account.isDefaultInternalReceive ? ' • Default receive' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Recipient email">
                  <input
                    aria-label="Recipient email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    inputMode="email"
                    onChange={(event) => {
                      setMemberForm((current) => ({ ...current, recipientEmail: event.target.value }));
                      setMemberRecipient(null);
                    }}
                    type="email"
                    value={memberForm.recipientEmail}
                  />
                </Field>
                <Field label="Transfer mode">
                  <select aria-label="Transfer mode" onChange={(event) => setMemberForm((current) => ({ ...current, scheduleMode: event.target.value as TransferScheduleMode }))} value={memberForm.scheduleMode}>
                    <option value="NOW">Now</option>
                    <option value="SCHEDULED">Schedule</option>
                  </select>
                </Field>
                <Field label="Amount">
                  <AmountInput onChange={setMemberAmountDigits} value={memberAmountDigits} />
                </Field>
                <Field label="Memo">
                  <input aria-label="Member memo" onChange={(event) => setMemberForm((current) => ({ ...current, memo: event.target.value }))} value={memberForm.memo} />
                </Field>
                {memberForm.scheduleMode === 'SCHEDULED' ? (
                  <>
                    <Field label="Cadence">
                      <select
                        aria-label="Member cadence"
                        onChange={(event) => setMemberForm((current) => {
                          const cadence = event.target.value as TransferCadence;
                          return {
                            ...current,
                            cadence,
                            endDate: cadence === 'Once' ? '' : current.endDate,
                          };
                        })}
                        value={memberForm.cadence}
                      >
                        {CADENCE_OPTIONS.map((cadence) => <option key={cadence} value={cadence}>{cadence}</option>)}
                      </select>
                    </Field>
                    <Field label="Start date">
                      <input aria-label="Member start date" onChange={(event) => setMemberForm((current) => ({ ...current, startDate: event.target.value }))} type="date" value={memberForm.startDate} />
                    </Field>
                    <Field label="Run time">
                      <input aria-label="Member run time" onChange={(event) => setMemberForm((current) => ({ ...current, runTime: event.target.value }))} type="time" value={memberForm.runTime} />
                    </Field>
                    {memberForm.cadence !== 'Once' ? (
                      <Field label="End date (optional)">
                        <input aria-label="Member end date" onChange={(event) => setMemberForm((current) => ({ ...current, endDate: event.target.value }))} type="date" value={memberForm.endDate} />
                      </Field>
                    ) : null}
                  </>
                ) : null}
                <Button onClick={handleReviewOpen} type="button">
                  {memberForm.scheduleMode === 'SCHEDULED' ? 'Review scheduled member transfer' : 'Review member transfer'}
                </Button>
              </div>
            ) : (
              <EmptyState
                title="Checking account required"
                description="Open a checking account before sending money to another SJ State Bank user."
              />
            )
          ) : null}

          {mode === 'EXTERNAL' ? (
            checkingAccounts.length ? (
              <div className="stack-lg">
                <Field label="Funding account">
                  <select aria-label="External funding account" onChange={(event) => setExternalForm((current) => ({ ...current, fromAccountId: event.target.value }))} value={externalFromAccountId}>
                    {checkingAccounts.map((account) => (
                      <option key={account.id} value={account.id}>{account.nickname} ({account.maskedNumber})</option>
                    ))}
                  </select>
                </Field>
                <Button onClick={() => setIsExternalAccountDialogOpen(true)} type="button" variant="secondary">
                  Choose bank
                </Button>
                {selectedExternalAccountId ? (
                  <div className="stack-sm">
                    <strong>Linked external account</strong>
                    <div className="selected-bank-card">
                      {selectedLinkedBank ? (
                        <img
                          alt={`${selectedExternalAccount?.bankName ?? 'External bank'} logo`}
                          className="selected-bank-card__logo"
                          src={selectedLinkedBank.logoSrc}
                        />
                      ) : null}
                      <span className="muted">
                        {selectedExternalAccount?.bankName ?? 'External bank'} ({selectedExternalAccount?.maskedAccountNumber ?? '...----'})
                      </span>
                    </div>
                  </div>
                ) : (
                  <InlineAlert title="Link a bank account first" tone="warning">
                    Use `Choose bank` to pick a bank and add account details before submitting an external transfer.
                  </InlineAlert>
                )}
                <Field label="Transfer mode">
                  <select aria-label="External transfer mode" onChange={(event) => setExternalForm((current) => ({ ...current, scheduleMode: event.target.value as TransferScheduleMode }))} value={externalForm.scheduleMode}>
                    <option value="NOW">Now</option>
                    <option value="SCHEDULED">Schedule</option>
                  </select>
                </Field>
                <Field label="Amount">
                  <AmountInput onChange={setExternalAmountDigits} value={externalAmountDigits} />
                </Field>
                <Field label="Memo">
                  <input aria-label="External memo" onChange={(event) => setExternalForm((current) => ({ ...current, memo: event.target.value }))} value={externalForm.memo} />
                </Field>
                {externalForm.scheduleMode === 'SCHEDULED' ? (
                  <>
                    <Field label="Cadence">
                      <select
                        aria-label="External cadence"
                        onChange={(event) => setExternalForm((current) => {
                          const cadence = event.target.value as TransferCadence;
                          return {
                            ...current,
                            cadence,
                            endDate: cadence === 'Once' ? '' : current.endDate,
                          };
                        })}
                        value={externalForm.cadence}
                      >
                        {CADENCE_OPTIONS.map((cadence) => <option key={cadence} value={cadence}>{cadence}</option>)}
                      </select>
                    </Field>
                    <Field label="Start date">
                      <input aria-label="External start date" onChange={(event) => setExternalForm((current) => ({ ...current, startDate: event.target.value }))} type="date" value={externalForm.startDate} />
                    </Field>
                    <Field label="Run time">
                      <input aria-label="External run time" onChange={(event) => setExternalForm((current) => ({ ...current, runTime: event.target.value }))} type="time" value={externalForm.runTime} />
                    </Field>
                    {externalForm.cadence !== 'Once' ? (
                      <Field label="End date (optional)">
                        <input aria-label="External end date" onChange={(event) => setExternalForm((current) => ({ ...current, endDate: event.target.value }))} type="date" value={externalForm.endDate} />
                      </Field>
                    ) : null}
                  </>
                ) : null}
                <Button onClick={handleReviewOpen} type="button">
                  {externalForm.scheduleMode === 'SCHEDULED' ? 'Review scheduled external transfer' : 'Review external transfer'}
                </Button>
              </div>
            ) : (
              <EmptyState
                title="Checking account required"
                description="Open a checking account before sending money to an external bank."
              />
            )
          ) : null}
        </Card>

        <Card>
          <div className="stack-lg">
            <div className="stack-sm">
              <p className="eyebrow">External transfers</p>
              <h3>In-flight external transfers</h3>
            </div>
            {externalTransfers.length ? externalTransfers.map((transfer) => (
              <div className="summary-row" key={transfer.id}>
                <div className="summary-row__primary">
                  <strong>{transfer.externalAccountLabel}</strong>
                  <span>{formatCurrency(transfer.amount)} • Submitted {formatDate(transfer.submittedAt)}</span>
                </div>
                <div className="summary-row__meta">
                  <StatusChip status={transfer.status} />
                </div>
              </div>
            )) : <p className="muted">No in-flight external transfers.</p>}
          </div>
        </Card>
      </div>

      <Card>
        <div className="stack-lg">
          <div className="stack-sm">
            <p className="eyebrow">Scheduled transfers</p>
            <h3>Upcoming runs</h3>
          </div>
          {scheduledTransfers.length ? scheduledTransfers.map((plan) => (
            <div className="summary-row" key={`${plan.kind}-${plan.id}`}>
              <div className="summary-row__primary">
                <strong>{plan.title}</strong>
                <span>{formatCurrency(plan.amount)} • {plan.summary}</span>
              </div>
              <div className="summary-row__meta">
                <StatusChip status={plan.status} />
                <Button
                  onClick={() => setPlanPendingCancel({ kind: plan.kind, id: plan.id, label: plan.cancelLabel })}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )) : <p className="muted">No scheduled transfers.</p>}
        </div>
      </Card>

      <Dialog
        actions={(
          <>
            <Button
              onClick={() => {
                if (externalAccountCreateMutation.isPending) return;
                setIsExternalAccountDialogOpen(false);
              }}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={externalAccountCreateMutation.isPending}
              onClick={async () => {
                try {
                  setErrorMessage(null);
                  await handleExternalAccountCreate();
                } catch (error) {
                  setErrorMessage(error instanceof Error ? error.message : 'Unable to link external account.');
                }
              }}
              type="button"
            >
              {externalAccountCreateMutation.isPending ? 'Linking...' : 'Link bank'}
            </Button>
          </>
        )}
        description="Sandbox linked via Stripe mock. Pick a common bank and provide account details to simulate live linking."
        onClose={() => {
          if (externalAccountCreateMutation.isPending) return;
          setIsExternalAccountDialogOpen(false);
        }}
        open={isExternalAccountDialogOpen}
        title="Choose bank"
      >
        {externalAccountCreateMutation.error instanceof Error ? (
          <InlineAlert title="Unable to save external account" tone="warning">
            {externalAccountCreateMutation.error.message}
          </InlineAlert>
        ) : null}
        <form className="stack-md" onSubmit={(event) => event.preventDefault()}>
          <Field label="Select a bank">
            <div className="bank-picker-grid" role="radiogroup" aria-label="Bank selection">
              {COMMON_BANKS.map((bank) => (
                <button
                  aria-label={`Select ${bank.name}`}
                  aria-checked={externalLinkForm.bankId === bank.id}
                  className={`bank-picker-option${externalLinkForm.bankId === bank.id ? ' bank-picker-option--selected' : ''}`}
                  key={bank.id}
                  onClick={() => setExternalLinkForm((current) => ({ ...current, bankId: bank.id }))}
                  role="radio"
                  type="button"
                >
                  <span className="bank-picker-option__check" aria-hidden="true">
                    {externalLinkForm.bankId === bank.id ? '✓' : ''}
                  </span>
                  <img alt={`${bank.name} logo`} className="bank-picker-option__logo" src={bank.logoSrc} />
                  <span>{bank.name}</span>
                </button>
              ))}
            </div>
          </Field>
          {selectedBankForLink ? (
            <div className="selected-bank-card selected-bank-card--active" aria-live="polite">
              <img alt={`${selectedBankForLink.name} logo`} className="selected-bank-card__logo" src={selectedBankForLink.logoSrc} />
              <div className="stack-sm">
                <strong>Selected bank: {selectedBankForLink.name}</strong>
                <span className="muted">Account details below will be linked to this bank.</span>
              </div>
            </div>
          ) : null}
          <Field label="Account type">
            <select
              aria-label="External account type"
              onChange={(event) => {
                setExternalLinkForm((current) => ({
                  ...current,
                  accountType: event.target.value as ExternalAccount['accountType'],
                }));
              }}
              value={externalLinkForm.accountType}
            >
              <option value="Checking">Checking</option>
              <option value="Savings">Savings</option>
            </select>
          </Field>
          <Field label="Routing number">
            <input
              aria-label="External routing number"
              inputMode="numeric"
              maxLength={9}
              onChange={(event) =>
                setExternalLinkForm((current) => ({ ...current, routingNumber: sanitizeDigits(event.target.value).slice(0, 9) }))}
              placeholder="123456789"
              value={externalLinkForm.routingNumber}
            />
          </Field>
          <Field label="Account number">
            <input
              aria-label="External account number"
              inputMode="numeric"
              maxLength={17}
              onChange={(event) =>
                setExternalLinkForm((current) => ({ ...current, accountNumber: sanitizeDigits(event.target.value).slice(0, 17) }))}
              placeholder="Enter account number"
              value={externalLinkForm.accountNumber}
            />
          </Field>
          <Field label="Confirm account number">
            <input
              aria-label="External confirm account number"
              inputMode="numeric"
              maxLength={17}
              onChange={(event) =>
                setExternalLinkForm((current) => ({ ...current, confirmAccountNumber: sanitizeDigits(event.target.value).slice(0, 17) }))}
              placeholder="Re-enter account number"
              value={externalLinkForm.confirmAccountNumber}
            />
          </Field>
          <p className="muted">Sandbox simulation only. No real money movement or real bank verification.</p>
        </form>
      </Dialog>

      <Dialog
        actions={(
          <>
            <Button onClick={() => setReview(null)} type="button" variant="secondary">Back</Button>
            <Button
              onClick={() => {
                if (!review) return;
                setErrorMessage(null);
                if (review.kind === 'SELF') {
                  selfSubmitMutation.mutate(review.payload);
                  return;
                }
                if (review.kind === 'MEMBER') {
                  memberSubmitMutation.mutate(review.payload);
                  return;
                }
                externalSubmitMutation.mutate(review.payload);
              }}
              disabled={reviewSubmitPending}
              type="button"
            >
              {reviewSubmitPending
                ? 'Submitting...'
                : review?.kind === 'SELF'
                  ? 'Submit transfer'
                  : review?.kind === 'MEMBER'
                    ? (review.payload.scheduleMode === 'SCHEDULED' ? 'Create schedule' : 'Submit member transfer')
                    : (review?.payload.scheduleMode === 'SCHEDULED' ? 'Create schedule' : 'Submit external transfer')}
            </Button>
          </>
        )}
        description="Confirm the transfer details before submitting."
        onClose={() => setReview(null)}
        open={Boolean(review)}
        title={reviewTitle ?? 'Review transfer'}
      >
        {review ? (
          <div className="stack-sm">
            {errorMessage ? (
              <InlineAlert title="Unable to submit transfer" tone="warning">
                {errorMessage}
              </InlineAlert>
            ) : null}
            {'fromAccountId' in review.payload ? <p><strong>From:</strong> {accounts.find((account) => account.id === review.payload.fromAccountId)?.nickname ?? 'Checking account'}</p> : null}
            {review.kind === 'SELF' ? <p><strong>To:</strong> {accounts.find((account) => account.id === review.payload.toAccountId)?.nickname ?? 'Account'}</p> : null}
            {review.kind === 'MEMBER' ? <p><strong>Recipient:</strong> {review.recipient.displayName} • {review.recipient.defaultCheckingAccountMasked}</p> : null}
            {review.kind === 'EXTERNAL' ? <p><strong>External account:</strong> {review.externalAccount?.bankName ?? 'External bank'} • {review.externalAccount?.maskedAccountNumber ?? ''}</p> : null}
            <p><strong>Amount:</strong> {formatCurrency(review.payload.amount)}</p>
            {review.payload.memo ? <p><strong>Memo:</strong> {review.payload.memo}</p> : null}
            {'transferDate' in review.payload && review.kind !== 'SELF' && review.payload.scheduleMode !== 'SCHEDULED' && review.payload.transferDate ? (
              <p><strong>Transfer date:</strong> {review.payload.transferDate}</p>
            ) : null}
            {review.kind === 'SELF' && review.payload.transferDate ? (
              <p><strong>Transfer date:</strong> {review.payload.transferDate}</p>
            ) : null}
            {review.kind !== 'SELF' && review.payload.scheduleMode === 'SCHEDULED' ? (
              <p><strong>Schedule:</strong> {review.payload.cadence} starting {review.payload.startDate} at {review.payload.runTime} ({review.payload.timezone})</p>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <Dialog
        actions={(
          <>
            <Button onClick={() => setPlanPendingCancel(null)} type="button" variant="secondary">Back</Button>
            <Button
              onClick={() => {
                if (!planPendingCancel) return;
                if (planPendingCancel.kind === 'MEMBER') {
                  cancelMemberPlanMutation.mutate(planPendingCancel.id);
                  return;
                }
                cancelExternalPlanMutation.mutate(planPendingCancel.id);
              }}
              type="button"
              variant="destructive"
            >
              Confirm cancel
            </Button>
          </>
        )}
        description="Future runs will stop. Past transfers stay in your history."
        onClose={() => setPlanPendingCancel(null)}
        open={Boolean(planPendingCancel)}
        title={planPendingCancel?.label ?? 'Cancel transfer?'}
      />
    </div>
  );
}
