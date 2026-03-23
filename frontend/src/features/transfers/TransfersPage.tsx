import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, EmptyState, Field, InlineAlert, PageHeader, StatusChip } from '../../components/ui';
import { accountsService, transfersService } from '../../lib/bankingApi';
import { formatCurrency } from '../../lib/format';

const transferSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  amount: z.number().positive(),
  memo: z.string().max(80).optional(),
  transferDate: z.string().min(1),
});

export function TransfersPage() {
  const queryClient = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: accountsService.list });
  const [review, setReview] = useState<z.infer<typeof transferSchema> | null>(null);
  const mutation = useMutation({
    mutationFn: transfersService.submit,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
    },
  });
  const form = useForm<z.infer<typeof transferSchema>>({
    resolver: zodResolver(transferSchema),
    defaultValues: {
      fromAccountId: '',
      toAccountId: '',
      amount: 0,
      memo: '',
      transferDate: new Date().toISOString().slice(0, 10),
    },
  });
  const hasTransferAccounts = accounts.length >= 2;

  useEffect(() => {
    if (!hasTransferAccounts) return;
    const currentFrom = form.getValues('fromAccountId');
    const currentTo = form.getValues('toAccountId');
    const nextFrom = accounts[0]?.id ?? '';
    const nextTo = accounts[1]?.id ?? '';

    if (!currentFrom || !accounts.some((account) => account.id === currentFrom)) {
      form.setValue('fromAccountId', nextFrom);
    }

    if (!currentTo || !accounts.some((account) => account.id === currentTo) || currentTo === nextFrom) {
      form.setValue('toAccountId', nextTo);
    }
  }, [accounts, form, hasTransferAccounts]);

  return (
    <div className="stack-xl">
      <PageHeader title="Transfers" eyebrow="Move money" subtitle="Transfer funds between your own accounts with a review step before submission." />
      <div className="grid-two">
        <Card>
          <form
            className="stack-lg"
            onSubmit={form.handleSubmit((values) => {
              if (!hasTransferAccounts) return;
              setReview(values);
            })}
          >
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
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.nickname} ({account.maskedNumber})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount" error={form.formState.errors.amount?.message}>
              <input {...form.register('amount', { valueAsNumber: true })} disabled={!hasTransferAccounts} min="0" step="0.01" type="number" />
            </Field>
            <Field label="Memo" error={form.formState.errors.memo?.message}>
              <input {...form.register('memo')} disabled={!hasTransferAccounts} />
            </Field>
            <Field label="Transfer date" error={form.formState.errors.transferDate?.message}>
              <input {...form.register('transferDate')} disabled={!hasTransferAccounts} type="date" />
            </Field>
            {!hasTransferAccounts ? (
              <EmptyState
                title="Transfers require two accounts"
                description="Open at least two accounts before reviewing or submitting transfers between them."
                action={<Link className="button button--secondary" to="/app/accounts">Open account</Link>}
              />
            ) : null}
            <Button disabled={!hasTransferAccounts} type="submit">Review transfer</Button>
          </form>
        </Card>
        <Card>
          <h3>Transfer review</h3>
          {review ? (
            <div className="stack-md">
              <dl className="stat-list">
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
                <div>
                  <dt>Date</dt>
                  <dd>{review.transferDate}</dd>
                </div>
              </dl>
              <Button
                onClick={async () => {
                  if (review && hasTransferAccounts) {
                    await mutation.mutateAsync(review);
                    setReview(null);
                  }
                }}
                disabled={mutation.isPending}
                type="button"
              >
                {mutation.isPending ? 'Submitting transfer...' : 'Submit transfer'}
              </Button>
            </div>
          ) : (
            <p className="muted">Fill out the form to review the transfer details before submitting.</p>
          )}
          {mutation.error ? (
            <InlineAlert title="Transfer could not be submitted" tone="warning">
              {mutation.error instanceof Error ? mutation.error.message : 'Something went wrong.'}
            </InlineAlert>
          ) : null}
          {mutation.data ? (
            <InlineAlert title="Transfer submitted" tone="success">
              Reference {mutation.data.id} <StatusChip status={mutation.data.status} />
            </InlineAlert>
          ) : null}
        </Card>
      </div>
      <Card>
        <h3>External transfers</h3>
        <p className="muted">External account transfers are currently unavailable online. Please contact support for additional transfer options.</p>
      </Card>
    </div>
  );
}
