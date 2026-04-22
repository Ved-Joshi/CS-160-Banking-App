import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, DataTable, Dialog, EmptyState, Field, InlineAlert, PageHeader, StatusChip } from '../../components/ui';
import { accountsService, payeesService, paymentsService } from '../../lib/bankingApi';
import { formatCurrency, formatDate } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';
import type { ScheduledPayment, UpdateScheduledPaymentInput } from '../../types/banking';

const paymentSchema = z.object({
  payeeId: z.string().min(1),
  accountId: z.string().min(1),
  amount: z.number().positive(),
  cadence: z.enum(['Once', 'Weekly', 'Monthly', 'Biweekly']),
  deliverBy: z.string().min(1),
});

const editPaymentSchema = z.object({
  payeeId: z.string().min(1),
  amount: z.number().positive(),
  cadence: z.enum(['Once', 'Weekly', 'Monthly', 'Biweekly']),
  deliverBy: z.string().min(1),
});

const payeeSetupSchema = z.object({
  name: z.string().trim().min(1, 'Payee name is required.').max(80, 'Payee name is too long.'),
  category: z.enum(['Utilities', 'Internet', 'Phone', 'Insurance', 'Rent', 'Loan', 'Credit Card', 'Healthcare', 'Other']),
});

const PAYEE_CATEGORY_OPTIONS = ['Utilities', 'Internet', 'Phone', 'Insurance', 'Rent', 'Loan', 'Credit Card', 'Healthcare', 'Other'] as const;

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

function toAmountDigits(amount: number): string {
  const cents = Math.max(0, Math.round(amount * 100));
  return String(cents);
}

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInputValue(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function addDaysToDateInput(value: string, days: number): string {
  const next = parseDateInputValue(value);
  next.setDate(next.getDate() + days);
  return formatDateInputValue(next);
}

function daysFromToday(dateValue: string | undefined): number | null {
  if (typeof dateValue !== 'string' || dateValue.length === 0) return null;
  const parts = dateValue.split('-').map(Number);
  if (parts.length !== 3 || Number.isNaN(parts[0]) || Number.isNaN(parts[1]) || Number.isNaN(parts[2])) {
    return null;
  }
  const targetDay = Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000;
  const now = new Date();
  const todayDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000;
  return targetDay - todayDay;
}

function formatRecurringNextRunLabel(deliverBy: string): string | null {
  const dayDiff = daysFromToday(deliverBy);
  if (dayDiff === null) return null;
  if (dayDiff === 0) return 'Next run today';
  if (dayDiff === 1) return 'Next run in 1 day';
  if (dayDiff > 1) return `Next run in ${dayDiff} days`;
  if (dayDiff === -1) return '1 day overdue';
  return `${Math.abs(dayDiff)} days overdue`;
}

function PaymentActionIcon({ icon }: { icon: 'retry' | 'edit' | 'delay' | 'delete' }) {
  if (icon === 'retry') {
    return (
      <svg aria-hidden="true" className="payment-action-icon__svg" viewBox="0 0 24 24">
        <path d="M20 6V2l-2.6 2.6A9 9 0 1 0 21 12h-2a7 7 0 1 1-2.2-5L14 10h6Z" />
      </svg>
    );
  }
  if (icon === 'edit') {
    return (
      <svg aria-hidden="true" className="payment-action-icon__svg" viewBox="0 0 24 24">
        <path d="m4 15.5 9.8-9.8 3.5 3.5-9.8 9.8L4 20l1.1-4.5ZM18.7 7.3l-2-2a1 1 0 0 1 0-1.4l1.2-1.2a1 1 0 0 1 1.4 0l2 2a1 1 0 0 1 0 1.4l-1.2 1.2a1 1 0 0 1-1.4 0Z" />
      </svg>
    );
  }
  if (icon === 'delay') {
    return (
      <svg aria-hidden="true" className="payment-action-icon__svg" viewBox="0 0 24 24">
        <path d="M12 1a1 1 0 0 1 1 1v1.1A9 9 0 1 1 3.1 11H2a1 1 0 0 1 0-2h3.5A1.5 1.5 0 0 1 7 10.5V14a1 1 0 1 1-2 0v-1.1A7 7 0 1 0 13 5.1V6a1 1 0 0 1-2 0V2a1 1 0 0 1 1-1Zm0 6a1 1 0 0 1 1 1v3.4l2.2 1.3a1 1 0 1 1-1 1.7l-2.7-1.6a1.5 1.5 0 0 1-.5-1.3V8a1 1 0 0 1 1-1Z" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" className="payment-action-icon__svg" viewBox="0 0 24 24">
      <path d="M9 3h6l1 2h4v2h-1v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7H4V5h4l1-2Zm-2 4v13h10V7H7Zm3 3h2v8h-2v-8Zm4 0h2v8h-2v-8Z" />
    </svg>
  );
}

export function BillPayPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const preferredAccountId = searchParams.get('accountId') ?? '';
  const { data: payees = [] } = useQuery({ queryKey: queryKeys.payees(), queryFn: payeesService.list });
  const { data: payments = [] } = useQuery({ queryKey: queryKeys.payments(), queryFn: paymentsService.list });
  const { data: accounts = [] } = useQuery({ queryKey: queryKeys.accounts(), queryFn: accountsService.list });

  const createPayeeMutation = useMutation({
    mutationFn: payeesService.create,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.payees() });
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: paymentsService.create,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.payments() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
      ]);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: paymentsService.cancel,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.payments() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
      ]);
    },
  });
  const updatePaymentMutation = useMutation({
    mutationFn: ({ paymentId, payload }: { paymentId: string; payload: UpdateScheduledPaymentInput }) =>
      paymentsService.update(paymentId, payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.payments() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
      ]);
    },
  });
  const retryPaymentMutation = useMutation({
    mutationFn: paymentsService.retry,
    onSuccess: async (updatedPayment) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.payments() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
      ]);
      const recurringNext = updatedPayment.cadence !== 'Once'
        ? formatRecurringNextRunLabel(updatedPayment.deliverBy)
        : null;
      if (updatedPayment.failureReason) {
        setRetryFeedback({
          tone: 'warning',
          title: 'Retry failed',
          message: updatedPayment.failureReason,
        });
        return;
      }
      if (updatedPayment.cadence === 'Once') {
        setRetryFeedback({
          tone: 'success',
          title: 'Payment retried successfully',
          message: 'The one-time payment completed and now appears in Transactions.',
        });
        return;
      }
      setRetryFeedback({
        tone: 'success',
        title: 'Payment retried successfully',
        message: recurringNext
          ? `${recurringNext}. This payment will continue on its recurring schedule.`
          : 'This payment will continue on its recurring schedule.',
      });
    },
  });

  const [amountDigits, setAmountDigits] = useState('');
  const [editAmountDigits, setEditAmountDigits] = useState('');
  const [editReplaceOnType, setEditReplaceOnType] = useState(false);
  const [paymentPendingCancel, setPaymentPendingCancel] = useState<ScheduledPayment | null>(null);
  const [paymentPendingEdit, setPaymentPendingEdit] = useState<ScheduledPayment | null>(null);
  const [paymentPendingRetry, setPaymentPendingRetry] = useState<ScheduledPayment | null>(null);
  const [retryDelayDate, setRetryDelayDate] = useState(formatDateInputValue(new Date()));
  const [retryFeedback, setRetryFeedback] = useState<{
    tone: 'neutral' | 'warning' | 'success';
    title: string;
    message: string;
  } | null>(null);
  const [isPayeeDialogOpen, setIsPayeeDialogOpen] = useState(false);
  const [isRecurringCadence, setIsRecurringCadence] = useState(false);

  const payeeForm = useForm<z.infer<typeof payeeSetupSchema>>({
    resolver: zodResolver(payeeSetupSchema),
    defaultValues: {
      name: '',
      category: 'Utilities',
    },
  });

  const paymentForm = useForm<z.infer<typeof paymentSchema>>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      payeeId: '',
      accountId: '',
      amount: 0,
      cadence: 'Once',
      deliverBy: new Date().toISOString().slice(0, 10),
    },
  });
  const editPaymentForm = useForm<z.infer<typeof editPaymentSchema>>({
    resolver: zodResolver(editPaymentSchema),
    defaultValues: {
      payeeId: '',
      amount: 0,
      cadence: 'Once',
      deliverBy: new Date().toISOString().slice(0, 10),
    },
  });

  const hasAccounts = accounts.length > 0;
  const hasPayees = payees.length > 0;
  const canSchedule = hasAccounts && hasPayees;
  const todayDate = formatDateInputValue(new Date());
  const amountDisplay = formatAmountDigits(amountDigits);
  const amountInputValue = `$${amountDisplay}`;
  const editAmountDisplay = formatAmountDigits(editAmountDigits);
  const editAmountInputValue = `$${editAmountDisplay}`;

  useEffect(() => {
    if (!hasAccounts) return;
    const currentAccountId = paymentForm.getValues('accountId');
    const requestedAccountId = accounts.some((account) => account.id === preferredAccountId)
      ? preferredAccountId
      : '';
    if (!currentAccountId || !accounts.some((account) => account.id === currentAccountId)) {
      paymentForm.setValue('accountId', requestedAccountId || accounts[0]?.id || '');
    }
  }, [accounts, paymentForm, hasAccounts, preferredAccountId]);

  useEffect(() => {
    if (!hasPayees) return;
    const currentPayeeId = paymentForm.getValues('payeeId');
    if (!currentPayeeId || !payees.some((payee) => payee.id === currentPayeeId)) {
      paymentForm.setValue('payeeId', payees[0]?.id ?? '');
    }
  }, [paymentForm, hasPayees, payees]);

  useEffect(() => {
    const normalizedAmount = amountDigits ? Number(amountDisplay) : 0;
    paymentForm.setValue('amount', normalizedAmount);
  }, [amountDigits, amountDisplay, paymentForm]);
  useEffect(() => {
    if (!paymentPendingEdit) return;
    editPaymentForm.reset({
      payeeId: paymentPendingEdit.payeeId,
      amount: paymentPendingEdit.amount,
      cadence: paymentPendingEdit.cadence,
      deliverBy: paymentPendingEdit.deliverBy,
    });
  }, [paymentPendingEdit, editPaymentForm]);
  useEffect(() => {
    const normalizedEditAmount = editAmountDigits ? Number(formatAmountDigits(editAmountDigits)) : 0;
    editPaymentForm.setValue('amount', normalizedEditAmount);
  }, [editAmountDigits, editPaymentForm]);
  const deliverByLabel = isRecurringCadence ? 'Start delivering by' : 'Deliver by';

  const canCancelPayment = (status: ScheduledPayment['status']) => status === 'SCHEDULED' || status === 'PROCESSING' || status === 'FAILED';
  const canRetryPayment = (status: ScheduledPayment['status']) => status === 'FAILED';
  const canEditPayment = (payment: ScheduledPayment) => payment.cadence !== 'Once' && payment.status === 'SCHEDULED';
  const visiblePayments = payments.filter(
    (payment) => payment.status !== 'CANCELLED' && !(payment.cadence === 'Once' && payment.status === 'COMPLETED'),
  );
  const rows = visiblePayments.map((payment) => [
    payment.payeeName,
    (
      <div className="payment-deliver-by" key={`${payment.id}-deliver-by`}>
        <span>{formatDate(payment.deliverBy)}</span>
        {payment.cadence !== 'Once' ? (
          <small className="muted">{formatRecurringNextRunLabel(payment.deliverBy) ?? ''}</small>
        ) : null}
      </div>
    ),
    payment.cadence,
    <StatusChip key={`${payment.id}-status`} status={payment.status} />,
    formatCurrency(payment.amount),
    <div className="payment-actions" key={`${payment.id}-actions`}>
      {canRetryPayment(payment.status) ? (
        <button
          aria-label={`Retry ${payment.payeeName} payment`}
          className="payment-action-icon payment-action-icon--retry"
          onClick={() => {
            const baseDate = payment.deliverBy >= todayDate ? payment.deliverBy : todayDate;
            setRetryDelayDate(addDaysToDateInput(baseDate, 1));
            setRetryFeedback(null);
            setPaymentPendingRetry(payment);
          }}
          title="Retry now"
          type="button"
        >
          <PaymentActionIcon icon="retry" />
        </button>
      ) : null}
      {canEditPayment(payment) ? (
        <button
          aria-label={`Edit ${payment.payeeName} payment`}
          className="payment-action-icon"
          onClick={() => {
            setEditAmountDigits(toAmountDigits(payment.amount));
            setEditReplaceOnType(true);
            setPaymentPendingEdit(payment);
          }}
          title="Edit payment"
          type="button"
        >
          <PaymentActionIcon icon="edit" />
        </button>
      ) : null}
      {canCancelPayment(payment.status) ? (
        <button
          aria-label={`Delete ${payment.payeeName} payment`}
          className="payment-action-icon payment-action-icon--delete"
          onClick={() => setPaymentPendingCancel(payment)}
          title="Delete payment"
          type="button"
        >
          <PaymentActionIcon icon="delete" />
        </button>
      ) : null}
      {!canRetryPayment(payment.status) && !canEditPayment(payment) && !canCancelPayment(payment.status) ? (
        <span className="muted">—</span>
      ) : null}
    </div>,
  ]);

  return (
    <div className="stack-xl">
      <PageHeader
        title="Bill Pay"
        eyebrow="Scheduled payments"
        subtitle="Schedule one-time or recurring bill payments from your selected account."
        actions={(
          <Button onClick={() => setIsPayeeDialogOpen(true)} type="button" variant="secondary">
            + Add payee
          </Button>
        )}
      />
      <div className="grid-two">
        <Card>
          <form
            className="stack-lg"
            onSubmit={paymentForm.handleSubmit(async (values) => {
              if (!canSchedule) return;
              if (values.deliverBy < new Date().toISOString().slice(0, 10)) {
                paymentForm.setError('deliverBy', { type: 'manual', message: 'Deliver by date cannot be in the past.' });
                return;
              }
              try {
                await scheduleMutation.mutateAsync(values);
              } catch {
                return;
              }
              paymentForm.reset({ ...values, amount: 0 });
              setIsRecurringCadence(values.cadence !== 'Once');
              setAmountDigits('');
            })}
          >
            <h3>Schedule payment</h3>
            {scheduleMutation.error instanceof Error ? (
              <InlineAlert title="Unable to schedule payment" tone="warning">
                {scheduleMutation.error.message}
              </InlineAlert>
            ) : null}
            <Field label="Payee" error={paymentForm.formState.errors.payeeId?.message}>
              <select {...paymentForm.register('payeeId')} disabled={!hasPayees}>
                {hasPayees ? payees.map((payee) => (
                  <option key={payee.id} value={payee.id}>
                    {payee.name}
                  </option>
                )) : <option value="">No payees yet</option>}
              </select>
            </Field>
            <Field label="Pay from" error={paymentForm.formState.errors.accountId?.message}>
              <select {...paymentForm.register('accountId')} disabled={!canSchedule}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.nickname}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount" error={paymentForm.formState.errors.amount?.message}>
              <input
                aria-label="Amount"
                disabled={!canSchedule}
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
            <Field label="Cadence" error={paymentForm.formState.errors.cadence?.message}>
              <Controller
                control={paymentForm.control}
                defaultValue="Once"
                name="cadence"
                render={({ field }) => (
                  <select
                    {...field}
                    disabled={!canSchedule}
                    onChange={(event) => {
                      field.onChange(event);
                      setIsRecurringCadence(event.target.value !== 'Once');
                    }}
                  >
                    <option value="Once">One time</option>
                    <option value="Weekly">Weekly</option>
                    <option value="Monthly">Monthly</option>
                    <option value="Biweekly">Biweekly</option>
                  </select>
                )}
              />
            </Field>
            <Field label={deliverByLabel} error={paymentForm.formState.errors.deliverBy?.message}>
              <input {...paymentForm.register('deliverBy')} disabled={!canSchedule} type="date" />
            </Field>
            {!hasAccounts ? (
              <EmptyState
                title="Bill pay needs an account"
                description="Open an account before scheduling payments to your payees."
                action={<Link className="button button--secondary" to="/app/accounts">Open account</Link>}
              />
            ) : !hasPayees ? (
              <InlineAlert title="Add a payee first" tone="warning">
                Use + Add payee to create your first payee, then schedule a payment.
              </InlineAlert>
            ) : null}
            <Button disabled={!canSchedule || scheduleMutation.isPending} type="submit">
              {scheduleMutation.isPending ? 'Scheduling payment...' : 'Schedule payment'}
            </Button>
          </form>
        </Card>
        <Card>
          <h3>Payment controls</h3>
          <p className="muted">Create payees inline, schedule one-time/recurring payments, and cancel pending payments from one place.</p>
          <div className="stack-sm">
            <span className="label-pill">Supports one-time and recurring schedules</span>
            <span className="label-pill">Statuses: scheduled, processing, completed, failed, cancelled</span>
          </div>
        </Card>
      </div>
      {rows.length ? (
        <Card>
          <h3>Scheduled payments</h3>
          <DataTable headers={['Payee', 'Deliver by', 'Cadence', 'Status', 'Amount', 'Actions']} rows={rows} />
        </Card>
      ) : (
        <EmptyState
          title="No upcoming bill payments"
          description="Scheduled bill payments will appear here after you create one."
        />
      )}
      {cancelMutation.error ? (
        <InlineAlert title="Unable to cancel payment" tone="warning">
          {cancelMutation.error instanceof Error ? cancelMutation.error.message : 'Something went wrong.'}
        </InlineAlert>
      ) : null}
      {retryPaymentMutation.error ? (
        <InlineAlert title="Unable to retry payment" tone="warning">
          {retryPaymentMutation.error instanceof Error ? retryPaymentMutation.error.message : 'Something went wrong.'}
        </InlineAlert>
      ) : null}
      {retryPaymentMutation.isPending && paymentPendingRetry ? (
        <InlineAlert title="Retry in progress" tone="neutral">
          We are submitting the payment retry now.
        </InlineAlert>
      ) : null}
      {retryFeedback ? (
        <InlineAlert title={retryFeedback.title} tone={retryFeedback.tone}>
          {retryFeedback.message}
        </InlineAlert>
      ) : null}
      {updatePaymentMutation.error ? (
        <InlineAlert title="Unable to update payment" tone="warning">
          {updatePaymentMutation.error instanceof Error ? updatePaymentMutation.error.message : 'Something went wrong.'}
        </InlineAlert>
      ) : null}
      <Dialog
        actions={(
          <>
            <Button
              onClick={() => {
                if (retryPaymentMutation.isPending || updatePaymentMutation.isPending) return;
                setPaymentPendingRetry(null);
              }}
              type="button"
              variant="secondary"
            >
              Keep as failed
            </Button>
            <Button
              disabled={updatePaymentMutation.isPending || !paymentPendingRetry || retryDelayDate <= todayDate}
              onClick={async () => {
                if (!paymentPendingRetry) return;
                if (retryDelayDate <= todayDate) return;
                await updatePaymentMutation.mutateAsync({
                  paymentId: paymentPendingRetry.id,
                  payload: { deliverBy: retryDelayDate },
                });
                setRetryFeedback({
                  tone: 'success',
                  title: 'Payment delayed',
                  message: `Retry moved to ${formatDate(retryDelayDate)}.`,
                });
                setPaymentPendingRetry(null);
              }}
              type="button"
              variant="secondary"
            >
              {updatePaymentMutation.isPending ? 'Delaying...' : 'Delay instead'}
            </Button>
            <Button
              disabled={retryPaymentMutation.isPending || !paymentPendingRetry}
              onClick={() => {
                if (!paymentPendingRetry) return;
                retryPaymentMutation.mutate(paymentPendingRetry.id, {
                  onSuccess: () => {
                    setPaymentPendingRetry(null);
                  },
                });
              }}
              type="button"
            >
              {retryPaymentMutation.isPending ? 'Retrying...' : 'Retry now'}
            </Button>
          </>
        )}
        description="Retry this failed payment now, or delay it to a future date."
        onClose={() => {
          if (retryPaymentMutation.isPending || updatePaymentMutation.isPending) return;
          setPaymentPendingRetry(null);
        }}
        open={paymentPendingRetry !== null}
        title={paymentPendingRetry ? `Retry ${paymentPendingRetry.payeeName} payment?` : 'Retry payment?'}
      >
        <form className="stack-md" onSubmit={(event) => event.preventDefault()}>
          <Field label="Delay to date">
            <input
              aria-label="Delay to date"
              min={addDaysToDateInput(todayDate, 1)}
              onChange={(event) => setRetryDelayDate(event.target.value)}
              type="date"
              value={retryDelayDate}
            />
          </Field>
          {retryDelayDate <= todayDate ? (
            <InlineAlert title="Choose a future date" tone="warning">
              Delayed retry must be scheduled for a future date.
            </InlineAlert>
          ) : null}
        </form>
      </Dialog>
      <Dialog
        actions={(
          <>
            <Button
              onClick={() => {
                if (cancelMutation.isPending) return;
                setPaymentPendingCancel(null);
              }}
              type="button"
              variant="secondary"
            >
              Keep payment
            </Button>
            <Button
              disabled={cancelMutation.isPending || !paymentPendingCancel}
              onClick={() => {
                if (!paymentPendingCancel) return;
                cancelMutation.mutate(paymentPendingCancel.id, {
                  onSuccess: () => {
                    setPaymentPendingCancel(null);
                  },
                });
              }}
              type="button"
              variant="destructive"
            >
              {cancelMutation.isPending ? 'Cancelling...' : 'Confirm cancel'}
            </Button>
          </>
        )}
        description="This stops future attempts for this scheduled bill payment."
        onClose={() => {
          if (cancelMutation.isPending) return;
          setPaymentPendingCancel(null);
        }}
        open={paymentPendingCancel !== null}
        title={paymentPendingCancel ? `Cancel ${paymentPendingCancel.payeeName} payment?` : 'Cancel payment?'}
      >
        {paymentPendingCancel ? (
          <div className="stack-sm">
            <div className="summary-row">
              <div className="summary-row__primary">
                <strong>Deliver by</strong>
              </div>
              <div className="summary-row__secondary">
                <span>{formatDate(paymentPendingCancel.deliverBy)}</span>
              </div>
            </div>
            <div className="summary-row">
              <div className="summary-row__primary">
                <strong>Amount</strong>
              </div>
              <div className="summary-row__secondary">
                <span>{formatCurrency(paymentPendingCancel.amount)}</span>
              </div>
            </div>
          </div>
        ) : null}
      </Dialog>
      <Dialog
        actions={(
          <>
            <Button
              onClick={() => {
                if (updatePaymentMutation.isPending) return;
                setPaymentPendingEdit(null);
                setEditAmountDigits('');
              }}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={updatePaymentMutation.isPending || !paymentPendingEdit}
              onClick={editPaymentForm.handleSubmit(async (values) => {
                if (!paymentPendingEdit) return;
                if (values.deliverBy < todayDate) {
                  editPaymentForm.setError('deliverBy', { type: 'manual', message: 'Deliver by date cannot be in the past.' });
                  return;
                }
                await updatePaymentMutation.mutateAsync({
                  paymentId: paymentPendingEdit.id,
                  payload: values,
                });
                setPaymentPendingEdit(null);
                setEditAmountDigits('');
                setEditReplaceOnType(false);
              })}
              type="button"
            >
              {updatePaymentMutation.isPending ? 'Saving...' : 'Save changes'}
            </Button>
          </>
        )}
        description="Update amount, payee, cadence, or start date for this scheduled payment."
        onClose={() => {
          if (updatePaymentMutation.isPending) return;
          setPaymentPendingEdit(null);
          setEditAmountDigits('');
        }}
        open={paymentPendingEdit !== null}
        title={paymentPendingEdit ? `Edit ${paymentPendingEdit.payeeName} payment` : 'Edit payment'}
      >
        <form className="stack-md" onSubmit={(event) => event.preventDefault()}>
          <Field label="Payee" error={editPaymentForm.formState.errors.payeeId?.message}>
            <select {...editPaymentForm.register('payeeId')}>
              {payees.map((payee) => (
                <option key={payee.id} value={payee.id}>
                  {payee.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount" error={editPaymentForm.formState.errors.amount?.message}>
            <input
              aria-label="Amount"
              inputMode="numeric"
              name="edit-amount"
              onFocus={(event) => {
                event.currentTarget.setSelectionRange(0, event.currentTarget.value.length);
                setEditReplaceOnType(true);
              }}
              onKeyDown={(event) => {
                if (event.key >= '0' && event.key <= '9') {
                  event.preventDefault();
                  setEditAmountDigits((prev) => (editReplaceOnType ? event.key : `${prev}${event.key}`).slice(0, 12));
                  setEditReplaceOnType(false);
                  return;
                }
                if (event.key === 'Backspace') {
                  event.preventDefault();
                  setEditAmountDigits((prev) => prev.slice(0, -1));
                  setEditReplaceOnType(false);
                  return;
                }
                if (event.key === 'Delete') {
                  event.preventDefault();
                  setEditAmountDigits('');
                  setEditReplaceOnType(false);
                  return;
                }
                const allowedKeys = ['Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'];
                if (allowedKeys.includes(event.key)) return;
                event.preventDefault();
              }}
              onChange={() => {
                // Input value is controlled via masked key handlers above.
              }}
              onPaste={(event) => {
                event.preventDefault();
                const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 12);
                setEditAmountDigits(pasted);
                setEditReplaceOnType(false);
              }}
              type="text"
              value={editAmountInputValue}
            />
          </Field>
          <Field label="Cadence" error={editPaymentForm.formState.errors.cadence?.message}>
            <select {...editPaymentForm.register('cadence')}>
              <option value="Once">One time</option>
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
              <option value="Biweekly">Biweekly</option>
            </select>
          </Field>
          <Field label="Deliver by" error={editPaymentForm.formState.errors.deliverBy?.message}>
            <input {...editPaymentForm.register('deliverBy')} type="date" />
          </Field>
        </form>
      </Dialog>
      <Dialog
        actions={(
          <>
            <Button
              onClick={() => {
                if (createPayeeMutation.isPending) return;
                setIsPayeeDialogOpen(false);
              }}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={createPayeeMutation.isPending}
              onClick={payeeForm.handleSubmit(async (values) => {
                const created = await createPayeeMutation.mutateAsync(values);
                payeeForm.reset({
                  name: '',
                  category: values.category,
                });
                paymentForm.setValue('payeeId', created.id);
                setIsPayeeDialogOpen(false);
              })}
              type="button"
            >
              {createPayeeMutation.isPending ? 'Adding payee...' : 'Add payee'}
            </Button>
          </>
        )}
        description="Create a payee once, then select it from the Bill Pay dropdown."
        onClose={() => {
          if (createPayeeMutation.isPending) return;
          setIsPayeeDialogOpen(false);
        }}
        open={isPayeeDialogOpen}
        title="Add payee"
      >
        {createPayeeMutation.error instanceof Error ? (
          <InlineAlert title="Unable to add payee" tone="warning">
            {createPayeeMutation.error.message}
          </InlineAlert>
        ) : null}
        <form className="stack-md" onSubmit={(event) => event.preventDefault()}>
          <Field label="Payee name" error={payeeForm.formState.errors.name?.message}>
            <input {...payeeForm.register('name')} placeholder="PG&E" />
          </Field>
          <Field label="Category" error={payeeForm.formState.errors.category?.message}>
            <select {...payeeForm.register('category')}>
              {PAYEE_CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
        </form>
      </Dialog>
    </div>
  );
}
