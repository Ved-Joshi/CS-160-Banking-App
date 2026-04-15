import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, EmptyState, Field, InlineAlert, PageHeader, StatusChip } from '../../components/ui';
import { accountsService, transfersService } from '../../lib/bankingApi';
import { formatCurrency } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';

const transferSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  amount: z.number().positive(),
  memo: z.string().max(80).optional(),
  transferDate: z.string().min(1),
}).refine((value) => value.fromAccountId !== value.toAccountId, {
  message: 'From and To accounts must be different.',
  path: ['toAccountId'],
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
  const [review, setReview] = useState<z.infer<typeof transferSchema> | null>(null);
  const [amountDigits, setAmountDigits] = useState('');
  const mutation = useMutation({
    mutationFn: transfersService.submit,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
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
  const amountDisplay = formatAmountDigits(amountDigits);
  const amountInputValue = `$${amountDisplay}`;

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

  const selectedFrom = useWatch({ control: form.control, name: 'fromAccountId' }) ?? '';
  const toAccountOptions = accounts.filter((account) => account.id !== selectedFrom);

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
                    mutation.mutate(review);
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
