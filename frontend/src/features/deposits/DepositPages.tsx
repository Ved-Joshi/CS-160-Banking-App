import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, DataTable, EmptyState, Field, PageHeader, StatusChip } from '../../components/ui';
import { accountsService, depositsService } from '../../lib/mockApi';
import { formatCurrency, formatDateTime } from '../../lib/format';

const depositSchema = z.object({
  accountId: z.string().min(1),
  amount: z.number().positive(),
  frontFileName: z.string().min(1),
  backFileName: z.string().min(1),
});

export function DepositsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedFiles, setSelectedFiles] = useState({
    front: 'No file selected',
    back: 'No file selected',
  });
  const { data: deposits = [] } = useQuery({ queryKey: ['deposits'], queryFn: depositsService.list });
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: accountsService.list });
  const mutation = useMutation({
    mutationFn: depositsService.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['deposits'] }),
  });
  const form = useForm<z.infer<typeof depositSchema>>({
    resolver: zodResolver(depositSchema),
    defaultValues: {
      accountId: 'acct-checking',
      amount: 250,
      frontFileName: '',
      backFileName: '',
    },
  });

  const rows = deposits.map((deposit) => [
    <Link key={`${deposit.id}-link`} className="text-link" to={`/app/deposits/${deposit.id}`}>
      {deposit.id}
    </Link>,
    formatDateTime(deposit.submittedAt),
    formatCurrency(deposit.amount),
    <StatusChip key={`${deposit.id}-status`} status={deposit.status} />,
  ]);

  return (
    <div className="stack-xl">
      <PageHeader title="Deposits" eyebrow="Mobile deposit" subtitle="Submit a check deposit and track the review status." />
      <div className="grid-two">
        <Card>
          <form
            className="stack-lg"
            onSubmit={form.handleSubmit(async (values) => {
              const created = await mutation.mutateAsync(values);
              navigate(`/app/deposits/${created.id}`);
            })}
          >
            <h3>Deposit a check</h3>
            <Field label="Deposit into" error={form.formState.errors.accountId?.message}>
              <select {...form.register('accountId')}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.nickname}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount" error={form.formState.errors.amount?.message}>
              <input {...form.register('amount', { valueAsNumber: true })} type="number" step="0.01" />
            </Field>
            <Field label="Front image upload" error={form.formState.errors.frontFileName?.message}>
              <label className="file-upload">
                <input
                  accept="image/*"
                  className="file-upload__input"
                  onChange={(event) => {
                    const fileName = event.target.files?.[0]?.name ?? '';
                    form.setValue('frontFileName', fileName, { shouldValidate: true });
                    setSelectedFiles((current) => ({
                      ...current,
                      front: fileName || 'No file selected',
                    }));
                  }}
                  type="file"
                />
                <span className="file-upload__button">Choose image</span>
                <span className="file-upload__name">{selectedFiles.front}</span>
              </label>
            </Field>
            <Field label="Back image upload" error={form.formState.errors.backFileName?.message}>
              <label className="file-upload">
                <input
                  accept="image/*"
                  className="file-upload__input"
                  onChange={(event) => {
                    const fileName = event.target.files?.[0]?.name ?? '';
                    form.setValue('backFileName', fileName, { shouldValidate: true });
                    setSelectedFiles((current) => ({
                      ...current,
                      back: fileName || 'No file selected',
                    }));
                  }}
                  type="file"
                />
                <span className="file-upload__button">Choose image</span>
                <span className="file-upload__name">{selectedFiles.back}</span>
              </label>
            </Field>
            <Button type="submit">Submit deposit</Button>
          </form>
        </Card>
        <Card>
          <h3>Review standards</h3>
          <ol className="plain-list">
            <li>Enter the check amount exactly as written.</li>
            <li>Capture front and back images clearly.</li>
            <li>Review the status timeline after submission.</li>
          </ol>
        </Card>
      </div>
      <Card>
        <h3>Recent deposits</h3>
        <DataTable headers={['Reference', 'Submitted', 'Amount', 'Status']} rows={rows} />
      </Card>
    </div>
  );
}

export function DepositDetailPage() {
  const { depositId = '' } = useParams();
  const { data: deposit } = useQuery({ queryKey: ['deposit', depositId], queryFn: () => depositsService.get(depositId) });

  if (!deposit) {
    return <EmptyState title="Deposit not found" description="The requested deposit could not be located. Please return to your deposit history and try again." />;
  }

  return (
    <div className="stack-xl">
      <PageHeader title={`Deposit ${deposit.id}`} eyebrow="Deposit tracking" subtitle="Follow review status and image submission details." />
      <div className="grid-two">
        <Card>
          <dl className="stat-list">
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
          <h3>Status timeline</h3>
          <div className="timeline">
            <div className="timeline__item timeline__item--complete">Images uploaded</div>
            <div className="timeline__item timeline__item--current">Manual review</div>
            <div className="timeline__item">Funds availability</div>
          </div>
          <p className="muted">{deposit.note}</p>
        </Card>
      </div>
    </div>
  );
}
