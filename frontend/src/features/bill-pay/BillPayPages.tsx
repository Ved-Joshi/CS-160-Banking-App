import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, DataTable, Dialog, EmptyState, Field, InlineAlert, PageHeader, StatusChip } from '../../components/ui';
import { accountsService, payeesService, paymentsService } from '../../lib/bankingApi';
import { formatCurrency, formatDate } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';
import type { ScheduledPayment } from '../../types/banking';

const paymentSchema = z.object({
  payeeId: z.string().min(1),
  accountId: z.string().min(1),
  amount: z.number().positive(),
  cadence: z.enum(['Once', 'Weekly', 'Monthly', 'Biweekly']),
  deliverBy: z.string().min(1),
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

export function BillPayPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const preferredAccountId = searchParams.get('accountId') ?? '';
  const { data: payees = [] } = useQuery({ queryKey: queryKeys.payees(), queryFn: payeesService.list });
  const { data: payments = [] } = useQuery({ queryKey: queryKeys.payments(), queryFn: paymentsService.list });
  const { data: accounts = [] } = useQuery({ queryKey: queryKeys.accounts(), queryFn: accountsService.list });
  const mutation = useMutation({
    mutationFn: paymentsService.create,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.payments() }),
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
  const [amountDigits, setAmountDigits] = useState('');
  const [paymentPendingCancel, setPaymentPendingCancel] = useState<ScheduledPayment | null>(null);
  const form = useForm<z.infer<typeof paymentSchema>>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      payeeId: '',
      accountId: '',
      amount: 0,
      cadence: 'Monthly',
      deliverBy: new Date().toISOString().slice(0, 10),
    },
  });
  const hasAccounts = accounts.length > 0;
  const hasPayees = payees.length > 0;
  const canSchedule = hasAccounts && hasPayees;
  const amountDisplay = formatAmountDigits(amountDigits);
  const amountInputValue = `$${amountDisplay}`;

  useEffect(() => {
    if (!hasAccounts) return;
    const currentAccountId = form.getValues('accountId');
    const requestedAccountId = accounts.some((account) => account.id === preferredAccountId)
      ? preferredAccountId
      : '';
    if (!currentAccountId || !accounts.some((account) => account.id === currentAccountId)) {
      form.setValue('accountId', requestedAccountId || accounts[0]?.id || '');
    }
  }, [accounts, form, hasAccounts, preferredAccountId]);

  useEffect(() => {
    if (!hasPayees) return;
    const currentPayeeId = form.getValues('payeeId');
    if (!currentPayeeId || !payees.some((payee) => payee.id === currentPayeeId)) {
      form.setValue('payeeId', payees[0]?.id ?? '');
    }
  }, [form, hasPayees, payees]);

  useEffect(() => {
    const normalizedAmount = amountDigits ? Number(amountDisplay) : 0;
    form.setValue('amount', normalizedAmount);
  }, [amountDigits, amountDisplay, form]);

  const canCancelPayment = (status: ScheduledPayment['status']) => status === 'SCHEDULED' || status === 'PROCESSING';
  const rows = payments.map((payment) => [
    payment.payeeName,
    formatDate(payment.deliverBy),
    payment.cadence,
    <StatusChip key={`${payment.id}-status`} status={payment.status} />,
    formatCurrency(payment.amount),
    canCancelPayment(payment.status) ? (
      <Button key={`${payment.id}-cancel`} onClick={() => setPaymentPendingCancel(payment)} type="button" variant="primary">
        Cancel
      </Button>
    ) : (
      <span className="muted" key={`${payment.id}-no-action`}>—</span>
    ),
  ]);

  return (
    <div className="stack-xl">
      <PageHeader title="Bill Pay" eyebrow="Scheduled payments" subtitle="Manage payees and schedule one-time or recurring bill payments." actions={<Link className="button button--secondary" to="/app/bill-pay/payees">View payees</Link>} />
      <div className="grid-two">
        <Card>
          <form
            className="stack-lg"
            onSubmit={form.handleSubmit(async (values) => {
              if (!canSchedule) return;
              if (values.deliverBy < new Date().toISOString().slice(0, 10)) {
                form.setError('deliverBy', { type: 'manual', message: 'Deliver by date cannot be in the past.' });
                return;
              }
              try {
                await mutation.mutateAsync(values);
              } catch {
                return;
              }
              form.reset({ ...values, amount: 0 });
              setAmountDigits('');
            })}
          >
            <h3>Schedule payment</h3>
            {mutation.error instanceof Error ? (
              <InlineAlert title="Unable to schedule payment" tone="warning">
                {mutation.error.message}
              </InlineAlert>
            ) : null}
            <Field label="Payee" error={form.formState.errors.payeeId?.message}>
              <select {...form.register('payeeId')} disabled={!canSchedule}>
                {payees.map((payee) => (
                  <option key={payee.id} value={payee.id}>
                    {payee.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Pay from" error={form.formState.errors.accountId?.message}>
              <select {...form.register('accountId')} disabled={!canSchedule}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.nickname}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount" error={form.formState.errors.amount?.message}>
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
            <Field label="Cadence" error={form.formState.errors.cadence?.message}>
              <select {...form.register('cadence')} disabled={!canSchedule}>
                <option value="Once">One time</option>
                <option value="Weekly">Weekly</option>
                <option value="Monthly">Monthly</option>
                <option value="Biweekly">Biweekly</option>
              </select>
            </Field>
            <Field label="Deliver by" error={form.formState.errors.deliverBy?.message}>
              <input {...form.register('deliverBy')} disabled={!canSchedule} type="date" />
            </Field>
            {!hasAccounts ? (
              <EmptyState
                title="Bill pay needs an account"
                description="Open an account before scheduling payments to your payees."
                action={<Link className="button button--secondary" to="/app/accounts">Open account</Link>}
              />
            ) : !hasPayees ? (
              <EmptyState
                title="No payees available"
                description="This profile does not have any active payees yet."
              />
            ) : null}
            <Button disabled={!canSchedule || mutation.isPending} type="submit">
              {mutation.isPending ? 'Scheduling payment...' : 'Schedule payment'}
            </Button>
          </form>
        </Card>
        <Card>
          <h3>Payment controls</h3>
          <p className="muted">Edit and cancel flows are represented in this MVP by showing status progression and keeping the table structure backend-ready.</p>
          <div className="stack-sm">
            <span className="label-pill">Supports one-time and recurring schedules</span>
            <span className="label-pill">Mock execution states: scheduled, processing, completed, failed</span>
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
    </div>
  );
}

export function PayeesPage() {
  const { data: payees = [] } = useQuery({ queryKey: queryKeys.payees(), queryFn: payeesService.list });

  if (!payees.length) {
    return <EmptyState title="No payees" description="This profile does not have any active payees yet." />;
  }

  return (
    <div className="stack-xl">
      <PageHeader title="Payees" eyebrow="Billing relationships" subtitle="Reference payees available for scheduled payments." />
      <div className="grid-three">
        {payees.map((payee) => (
          <Card key={payee.id}>
            <p className="eyebrow">{payee.category}</p>
            <h3>{payee.name}</h3>
            <p className="muted">Account {payee.accountMask}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
