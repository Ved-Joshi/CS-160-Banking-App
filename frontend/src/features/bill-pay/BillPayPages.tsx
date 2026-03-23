import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, DataTable, EmptyState, Field, PageHeader, StatusChip } from '../../components/ui';
import { accountsService } from '../../lib/bankingApi';
import { billPayService } from '../../lib/mockApi';
import { formatCurrency, formatDate } from '../../lib/format';

const paymentSchema = z.object({
  payeeId: z.string().min(1),
  accountId: z.string().min(1),
  amount: z.number().positive(),
  cadence: z.enum(['Once', 'Monthly', 'Biweekly']),
  deliverBy: z.string().min(1),
});

export function BillPayPage() {
  const queryClient = useQueryClient();
  const { data: payees = [] } = useQuery({ queryKey: ['payees'], queryFn: billPayService.listPayees });
  const { data: payments = [] } = useQuery({ queryKey: ['payments'], queryFn: billPayService.listPayments });
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: accountsService.list });
  const mutation = useMutation({
    mutationFn: billPayService.createPayment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });
  const form = useForm<z.infer<typeof paymentSchema>>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      payeeId: 'payee-1',
      accountId: '',
      amount: 145,
      cadence: 'Monthly',
      deliverBy: new Date().toISOString().slice(0, 10),
    },
  });
  const hasAccounts = accounts.length > 0;

  useEffect(() => {
    if (!hasAccounts) return;
    const currentAccountId = form.getValues('accountId');
    if (!currentAccountId || !accounts.some((account) => account.id === currentAccountId)) {
      form.setValue('accountId', accounts[0]?.id ?? '');
    }
  }, [accounts, form, hasAccounts]);

  const rows = payments.map((payment) => [
    payment.payeeName,
    formatDate(payment.deliverBy),
    payment.cadence,
    <StatusChip key={`${payment.id}-status`} status={payment.status} />,
    formatCurrency(payment.amount),
  ]);

  return (
    <div className="stack-xl">
      <PageHeader title="Bill Pay" eyebrow="Scheduled payments" subtitle="Manage payees and schedule one-time or recurring bill payments." actions={<Link className="button button--secondary" to="/app/bill-pay/payees">View payees</Link>} />
      <div className="grid-two">
        <Card>
          <form
            className="stack-lg"
            onSubmit={form.handleSubmit(async (values) => {
              if (!hasAccounts) return;
              await mutation.mutateAsync(values);
              form.reset({ ...values, amount: 0 });
            })}
          >
            <h3>Schedule payment</h3>
            <Field label="Payee" error={form.formState.errors.payeeId?.message}>
              <select {...form.register('payeeId')} disabled={!hasAccounts}>
                {payees.map((payee) => (
                  <option key={payee.id} value={payee.id}>
                    {payee.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Pay from" error={form.formState.errors.accountId?.message}>
              <select {...form.register('accountId')} disabled={!hasAccounts}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.nickname}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount" error={form.formState.errors.amount?.message}>
              <input {...form.register('amount', { valueAsNumber: true })} disabled={!hasAccounts} step="0.01" type="number" />
            </Field>
            <Field label="Cadence" error={form.formState.errors.cadence?.message}>
              <select {...form.register('cadence')} disabled={!hasAccounts}>
                <option value="Once">One time</option>
                <option value="Monthly">Monthly</option>
                <option value="Biweekly">Biweekly</option>
              </select>
            </Field>
            <Field label="Deliver by" error={form.formState.errors.deliverBy?.message}>
              <input {...form.register('deliverBy')} disabled={!hasAccounts} type="date" />
            </Field>
            {!hasAccounts ? (
              <EmptyState
                title="Bill pay needs an account"
                description="Open an account before scheduling payments to your payees."
                action={<Link className="button button--secondary" to="/app/accounts">Open account</Link>}
              />
            ) : null}
            <Button disabled={!hasAccounts} type="submit">Schedule payment</Button>
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
      <Card>
        <h3>Scheduled payments</h3>
        <DataTable headers={['Payee', 'Deliver by', 'Cadence', 'Status', 'Amount']} rows={rows} />
      </Card>
    </div>
  );
}

export function PayeesPage() {
  const { data: payees = [] } = useQuery({ queryKey: ['payees'], queryFn: billPayService.listPayees });

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
