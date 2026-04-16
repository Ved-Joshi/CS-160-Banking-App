import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, EmptyState, Field, InlineAlert, PageHeader, StatusChip } from '../../components/ui';
import { accountsService, profileService, transfersService } from '../../lib/bankingApi';
import { formatCurrency, formatDate } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';
import type { TransferCadence, TransferRequest, TransferScheduleMode } from '../../types/banking';

const transferSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  amount: z.number().positive(),
  memo: z.string().max(80).optional(),
  transferDate: z.string().min(1),
  scheduleMode: z.enum(['NOW', 'SCHEDULED']),
  cadence: z.enum(['Once', 'Daily', 'Weekly', 'Biweekly', 'Monthly']),
  startDate: z.string().optional(),
  runTime: z.string().optional(),
  endDate: z.string().optional(),
  timezone: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.fromAccountId === value.toAccountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'From and To accounts must be different.',
      path: ['toAccountId'],
    });
  }

  if (value.scheduleMode !== 'SCHEDULED') return;

  if (!value.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Start date is required.',
      path: ['startDate'],
    });
  }
  if (!value.runTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Run time is required.',
      path: ['runTime'],
    });
  }
  if (!value.timezone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Timezone is required.',
      path: ['timezone'],
    });
  }
  if (value.endDate && value.startDate && value.endDate < value.startDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'End date must be on or after start date.',
      path: ['endDate'],
    });
  }
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

export function TransfersPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const preferredFromAccountId = searchParams.get('fromAccountId') ?? '';
  const { data: accounts = [] } = useQuery({ queryKey: queryKeys.accounts(), queryFn: accountsService.list });
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: profileService.get });
  const { data: transferPlans = [] } = useQuery({ queryKey: queryKeys.transferPlans(), queryFn: transfersService.listPlans });
  const [review, setReview] = useState<z.infer<typeof transferSchema> | null>(null);
  const [amountDigits, setAmountDigits] = useState('');
  const submitMutation = useMutation({
    mutationFn: transfersService.submit,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.transferPlans() }),
      ]);
    },
  });
  const cancelPlanMutation = useMutation({
    mutationFn: transfersService.cancelPlan,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.transferPlans() });
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const form = useForm<z.infer<typeof transferSchema>>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      fromAccountId: '',
      toAccountId: '',
      amount: 0,
      memo: '',
      transferDate: today,
      scheduleMode: 'NOW',
      cadence: 'Once',
      startDate: today,
      runTime: '09:00',
      endDate: '',
      timezone: '',
    },
  });

  const hasTransferAccounts = accounts.length >= 2;
  const amountDisplay = formatAmountDigits(amountDigits);
  const amountInputValue = `$${amountDisplay}`;
  const scheduleMode = useWatch({ control: form.control, name: 'scheduleMode' }) ?? 'NOW';
  const selectedFrom = useWatch({ control: form.control, name: 'fromAccountId' }) ?? '';
  const toAccountOptions = accounts.filter((account) => account.id !== selectedFrom);

  useEffect(() => {
    if (!hasTransferAccounts) return;
    const currentFrom = form.getValues('fromAccountId');
    const currentTo = form.getValues('toAccountId');
    const requestedFrom = accounts.some((account) => account.id === preferredFromAccountId)
      ? preferredFromAccountId
      : '';
    const nextFrom = requestedFrom || accounts[0]?.id || '';
    const effectiveFrom = currentFrom && accounts.some((account) => account.id === currentFrom)
      ? currentFrom
      : nextFrom;
    const nextTo = accounts.find((account) => account.id !== effectiveFrom)?.id ?? '';

    if (!currentFrom || !accounts.some((account) => account.id === currentFrom)) {
      form.setValue('fromAccountId', nextFrom);
    }

    if (!currentTo || !accounts.some((account) => account.id === currentTo) || currentTo === effectiveFrom) {
      form.setValue('toAccountId', nextTo);
    }
  }, [accounts, form, hasTransferAccounts, preferredFromAccountId]);

  useEffect(() => {
    const normalizedAmount = amountDigits ? Number(amountDisplay) : 0;
    form.setValue('amount', normalizedAmount);
  }, [amountDigits, amountDisplay, form]);

  useEffect(() => {
    if (!profile?.timezone) return;
    if (form.getValues('timezone')) return;
    form.setValue('timezone', profile.timezone);
  }, [form, profile?.timezone]);

  const schedulePlans = transferPlans.filter((plan) => plan.status === 'SCHEDULED' || plan.status === 'PROCESSING');

  return (
    <div className="stack-xl">
      <PageHeader title="Transfers" eyebrow="Move money" subtitle="Transfer now or schedule recurring transfers between your own accounts." />
      <div className="grid-two">
        <Card>
          <form
            className="stack-lg"
            onSubmit={form.handleSubmit((values) => {
              if (!hasTransferAccounts) return;
              setReview(values);
            })}
          >
            <Field label="Transfer mode" error={form.formState.errors.scheduleMode?.message}>
              <select {...form.register('scheduleMode')} disabled={!hasTransferAccounts}>
                <option value="NOW">Now</option>
                <option value="SCHEDULED">Schedule</option>
              </select>
            </Field>
            <Field label="From account" error={form.formState.errors.fromAccountId?.message}>
              <select {...form.register('fromAccountId')} disabled={!hasTransferAccounts}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.nickname} ({account.maskedNumber})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="To account" error={form.formState.errors.toAccountId?.message}>
              <select {...form.register('toAccountId')} disabled={!hasTransferAccounts}>
                {toAccountOptions.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.nickname} ({account.maskedNumber})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount" error={form.formState.errors.amount?.message}>
              <input
                aria-label="Amount"
                disabled={!hasTransferAccounts}
                inputMode="numeric"
                name="amount"
                onFocus={(event) => {
                  event.currentTarget.setSelectionRange(0, event.currentTarget.value.length);
                }}
                onKeyDown={(event) => {
                  if (event.key >= '0' && event.key <= '9') {
                    event.preventDefault();
                    setAmountDigits((prev) => `${prev}${event.key}`.slice(0, 12));
                    return;
                  }
                  if (event.key === 'Backspace') {
                    event.preventDefault();
                    setAmountDigits((prev) => prev.slice(0, -1));
                    return;
                  }
                  if (event.key === 'Delete') {
                    event.preventDefault();
                    setAmountDigits('');
                    return;
                  }
                  const allowedKeys = ['Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'];
                  if (allowedKeys.includes(event.key)) return;
                  event.preventDefault();
                }}
                onPaste={(event) => {
                  event.preventDefault();
                  const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 12);
                  setAmountDigits(pasted);
                }}
                type="text"
                value={amountInputValue}
              />
            </Field>
            <Field label="Memo" error={form.formState.errors.memo?.message}>
              <input {...form.register('memo')} disabled={!hasTransferAccounts} />
            </Field>
            {scheduleMode === 'NOW' ? (
              <Field label="Transfer date" error={form.formState.errors.transferDate?.message}>
                <input {...form.register('transferDate')} disabled={!hasTransferAccounts} type="date" />
              </Field>
            ) : (
              <>
                <Field label="Cadence" error={form.formState.errors.cadence?.message}>
                  <select {...form.register('cadence')} disabled={!hasTransferAccounts}>
                    {(['Once', 'Daily', 'Weekly', 'Biweekly', 'Monthly'] as TransferCadence[]).map((cadence) => (
                      <option key={cadence} value={cadence}>
                        {cadence}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Start date" error={form.formState.errors.startDate?.message}>
                  <input {...form.register('startDate')} disabled={!hasTransferAccounts} type="date" />
                </Field>
                <Field label="Run time" error={form.formState.errors.runTime?.message}>
                  <input {...form.register('runTime')} disabled={!hasTransferAccounts} type="time" />
                </Field>
                <Field label="End date (optional)" error={form.formState.errors.endDate?.message}>
                  <input {...form.register('endDate')} disabled={!hasTransferAccounts} type="date" />
                </Field>
                <Field label="Timezone" error={form.formState.errors.timezone?.message}>
                  <input {...form.register('timezone')} disabled={!hasTransferAccounts} placeholder="America/Los_Angeles" />
                </Field>
              </>
            )}
            {!hasTransferAccounts ? (
              <EmptyState
                title="Transfers require two accounts"
                description="Open at least two accounts before reviewing or submitting transfers between them."
                action={<Link className="button button--secondary" to="/app/accounts">Open account</Link>}
              />
            ) : null}
            <Button disabled={!hasTransferAccounts} type="submit">
              {scheduleMode === 'SCHEDULED' ? 'Review scheduled transfer' : 'Review transfer'}
            </Button>
          </form>
        </Card>
        <Card>
          <h3>Transfer review</h3>
          {review ? (
            <div className="stack-md">
              <dl className="stat-list">
                <div>
                  <dt>Mode</dt>
                  <dd>{review.scheduleMode === 'SCHEDULED' ? 'Scheduled' : 'Now'}</dd>
                </div>
                <div>
                  <dt>From</dt>
                  <dd>{accounts.find((account) => account.id === review.fromAccountId)?.nickname}</dd>
                </div>
                <div>
                  <dt>To</dt>
                  <dd>{accounts.find((account) => account.id === review.toAccountId)?.nickname}</dd>
                </div>
                <div>
                  <dt>Amount</dt>
                  <dd>{formatCurrency(review.amount)}</dd>
                </div>
                {review.scheduleMode === 'SCHEDULED' ? (
                  <>
                    <div>
                      <dt>Cadence</dt>
                      <dd>{review.cadence}</dd>
                    </div>
                    <div>
                      <dt>Starts</dt>
                      <dd>{review.startDate || '—'} at {review.runTime || '—'}</dd>
                    </div>
                    <div>
                      <dt>Timezone</dt>
                      <dd>{review.timezone || '—'}</dd>
                    </div>
                    {review.endDate ? (
                      <div>
                        <dt>Ends</dt>
                        <dd>{review.endDate}</dd>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div>
                    <dt>Date</dt>
                    <dd>{review.transferDate}</dd>
                  </div>
                )}
              </dl>
              <Button
                onClick={async () => {
                  if (!review || !hasTransferAccounts) return;
                  const request: TransferRequest = {
                    fromAccountId: review.fromAccountId,
                    toAccountId: review.toAccountId,
                    amount: review.amount,
                    memo: review.memo,
                    transferDate: review.transferDate,
                    scheduleMode: review.scheduleMode as TransferScheduleMode,
                  };
                  if (review.scheduleMode === 'SCHEDULED') {
                    request.cadence = review.cadence;
                    request.startDate = review.startDate;
                    request.runTime = review.runTime;
                    request.endDate = review.endDate || undefined;
                    request.timezone = review.timezone;
                  }

                  submitMutation.mutate(request, {
                    onSuccess: () => {
                      setReview(null);
                    },
                  });
                }}
                disabled={submitMutation.isPending}
                type="button"
              >
                {submitMutation.isPending
                  ? 'Submitting transfer...'
                  : review.scheduleMode === 'SCHEDULED'
                    ? 'Create schedule'
                    : 'Submit transfer'}
              </Button>
            </div>
          ) : (
            <p className="muted">Fill out the form to review transfer details before submitting.</p>
          )}
          {submitMutation.error ? (
            <InlineAlert title="Transfer could not be submitted" tone="warning">
              {submitMutation.error instanceof Error ? submitMutation.error.message : 'Something went wrong.'}
            </InlineAlert>
          ) : null}
          {submitMutation.data?.transfer ? (
            <InlineAlert title="Transfer submitted" tone="success">
              Reference {submitMutation.data.transfer.id} <StatusChip status={submitMutation.data.transfer.status} />
            </InlineAlert>
          ) : null}
          {submitMutation.data?.plan ? (
            <InlineAlert title="Scheduled transfer created" tone="success">
              Plan {submitMutation.data.plan.id} <StatusChip status={submitMutation.data.plan.status} />
            </InlineAlert>
          ) : null}
        </Card>
      </div>
      <Card>
        <h3>Scheduled transfers</h3>
        {schedulePlans.length ? (
          <div className="list-stack">
            {schedulePlans.map((plan) => (
              <div className="summary-row" key={plan.id}>
                <div className="summary-row__primary">
                  <strong>{formatCurrency(plan.amount)} • {plan.cadence}</strong>
                  <p className="muted">
                    Next run {plan.nextRunAt ? formatDate(plan.nextRunAt) : '—'} at {plan.runTime} ({plan.timezone})
                  </p>
                </div>
                <div className="summary-row__secondary">
                  <StatusChip status={plan.status} />
                  <Button
                    disabled={cancelPlanMutation.isPending}
                    onClick={() => {
                      cancelPlanMutation.mutate(plan.id);
                    }}
                    type="button"
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No scheduled transfers"
            description="Scheduled and recurring transfers will appear here after you create one."
          />
        )}
        {cancelPlanMutation.error ? (
          <InlineAlert title="Unable to cancel transfer plan" tone="warning">
            {cancelPlanMutation.error instanceof Error ? cancelPlanMutation.error.message : 'Something went wrong.'}
          </InlineAlert>
        ) : null}
      </Card>
      <Card>
        <h3>External transfers</h3>
        <p className="muted">External account transfers are currently unavailable online. Please contact support for additional transfer options.</p>
      </Card>
    </div>
  );
}
