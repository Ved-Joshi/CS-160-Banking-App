import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, Dialog, EmptyState, Field, InlineAlert, PageHeader, StatusChip } from '../../components/ui';
import { accountsService, transactionsService } from '../../lib/bankingApi';
import { formatCurrency, formatDate } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';
import type { AccountType } from '../../types/banking';

const createAccountSchema = z.object({
  nickname: z.string().min(2, 'Nickname must be at least 2 characters.').max(80),
  type: z.enum(['Checking', 'Savings', 'Credit']),
});

const accountTypeContent: Record<AccountType, { eyebrow: string; summary: string; detail: string }> = {
  Checking: {
    eyebrow: 'Everyday banking',
    summary: 'Built for direct deposit, purchases, and routine money movement.',
    detail: 'Checking accounts receive the standard routing number used in the current demo environment and appear immediately across transfers, bill pay, and deposits.',
  },
  Savings: {
    eyebrow: 'Set money aside',
    summary: 'A simple savings product for short-term reserves and emergency funds.',
    detail: 'Savings accounts also receive the demo routing number and can be used anywhere the dashboard offers account selection.',
  },
  Credit: {
    eyebrow: 'Borrowing line',
    summary: 'Track revolving balance activity without showing a routing number.',
    detail: 'Credit accounts appear in your account list right away and are available for activity views, but do not receive a routing number.',
  },
};

type AccountsNavigationState = {
  createdAccountId?: string;
  createdAccountName?: string;
  closedAccountName?: string;
} | null;

type BannerState =
  | { title: string; body: string; tone: 'success' | 'warning' | 'neutral' }
  | null;

function buildAccountsBanner(state: AccountsNavigationState): BannerState {
  if (!state) return null;
  if (state.createdAccountId && state.createdAccountName) {
    return {
      title: 'Account created',
      body: `${state.createdAccountName} is now available in your active accounts.`,
      tone: 'success',
    };
  }
  if (state.closedAccountName) {
    return {
      title: 'Account closed',
      body: `${state.closedAccountName} has been closed and removed from your active accounts.`,
      tone: 'success',
    };
  }
  return null;
}

function getAccountDetailTheme(type: AccountType) {
  return {
    className: `account-hero account-hero--${type.toLowerCase()}`,
    label:
      type === 'Checking'
        ? 'Built for everyday spending and transfers.'
        : type === 'Savings'
          ? 'Set aside cash and watch activity stay clean and deliberate.'
          : 'Track revolving balance and credit activity in one place.',
  };
}

export function AccountsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationState = location.state as AccountsNavigationState;
  const [banner] = useState<BannerState>(() => buildAccountsBanner(navigationState));
  const [highlightedAccountId] = useState<string | null>(() => navigationState?.createdAccountId ?? null);
  const {
    data: accounts = [],
    error: accountsError,
    isLoading: accountsLoading,
  } = useQuery({ queryKey: queryKeys.accounts(), queryFn: accountsService.list });

  useEffect(() => {
    if (!navigationState) return;
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, navigate, navigationState]);

  return (
    <div className="stack-xl">
      <PageHeader
        title="Accounts"
        eyebrow="Balances and details"
        subtitle="Review active accounts, open new products, and jump into recent account activity."
        actions={
          accounts.length ? (
            <Link className="button button--primary" to="/app/accounts/new">
              + Open account
            </Link>
          ) : undefined
        }
      />
      {banner ? (
        <InlineAlert title={banner.title} tone={banner.tone}>
          {banner.body}
        </InlineAlert>
      ) : null}
      {accountsError ? (
        <InlineAlert title="Unable to load accounts" tone="warning">
          {accountsError instanceof Error ? accountsError.message : 'Something went wrong while loading your accounts.'}
        </InlineAlert>
      ) : null}
      {accountsLoading ? (
        <div className="grid-three">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card className="account-card account-card--skeleton" key={index}>
              <div className="stack-md">
                <span className="skeleton-block skeleton-block--sm" />
                <span className="skeleton-block skeleton-block--lg" />
                <span className="skeleton-block skeleton-block--md" />
                <span className="skeleton-block skeleton-block--lg" />
              </div>
            </Card>
          ))}
        </div>
      ) : null}
      {!accountsLoading && !accountsError && !accounts.length ? (
        <EmptyState
          title="No active accounts yet"
          description="Open your first banking product to start tracking balances, payments, transfers, and deposits from the dashboard."
          action={(
            <Link className="button button--primary" to="/app/accounts/new">
              Open account
            </Link>
          )}
        />
      ) : null}
      {!accountsLoading && accounts.length ? (
        <div className="grid-three">
          {accounts.map((account) => (
            <Card
              className={account.id === highlightedAccountId ? 'account-card account-card--highlight' : 'account-card'}
              key={account.id}
            >
              <div className="stack-md">
                <div className="stack-sm">
                  <p className="eyebrow">{account.type}</p>
                  <h3>{account.nickname}</h3>
                </div>
                <p className="muted">{account.maskedNumber || '••••'}</p>
                <dl className="stat-list">
                  <div>
                    <dt>Available</dt>
                    <dd>{formatCurrency(account.balances.availableBalance)}</dd>
                  </div>
                  <div>
                    <dt>Current</dt>
                    <dd>{formatCurrency(account.balances.currentBalance)}</dd>
                  </div>
                </dl>
                <div className="account-card__footer">
                  <span className="muted">Opened {formatDate(account.openedAt)}</span>
                  <Link className="text-link account-card__link" to={`/app/accounts/${account.id}`}>
                    View activity
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function OpenAccountPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useForm<z.infer<typeof createAccountSchema>>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: {
      nickname: '',
      type: 'Checking',
    },
  });
  const nicknameField = form.register('nickname');
  const typeField = form.register('type');
  const selectedType = useWatch({
    control: form.control,
    name: 'type',
  }) ?? 'Checking';
  const createAccount = useMutation({
    mutationFn: accountsService.create,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts() });
      navigate('/app/accounts', {
        state: {
          createdAccountId: created.id,
          createdAccountName: created.nickname,
        } satisfies AccountsNavigationState,
      });
    },
  });

  const selectedContent = accountTypeContent[selectedType];

  return (
    <div className="stack-xl">
      <PageHeader
        title="Open account"
        eyebrow="New banking product"
        subtitle="Choose the product that fits how you plan to use the account, then give it a recognizable nickname."
        actions={<Link className="button button--secondary" to="/app/accounts">Back to accounts</Link>}
      />
      <div className="grid-two">
        <Card>
          <form
            className="stack-lg"
            onSubmit={form.handleSubmit(async (values) => {
              createAccount.reset();
              await createAccount.mutateAsync(values);
            })}
          >
            <div className="stack-sm">
              <p className="eyebrow">Choose a product</p>
              <h3>Select an account type</h3>
              <p className="muted">Your choice controls the account’s routing details and how it appears around the banking experience.</p>
            </div>
            {createAccount.error ? (
              <InlineAlert title="Unable to open account" tone="warning">
                {createAccount.error instanceof Error ? createAccount.error.message : 'Something went wrong while opening the account.'}
              </InlineAlert>
            ) : null}
            <div className="product-grid" role="radiogroup" aria-label="Account type">
              {(Object.keys(accountTypeContent) as AccountType[]).map((type) => {
                const content = accountTypeContent[type];
                const selected = selectedType === type;
                return (
                  <label className={selected ? 'product-card product-card--selected' : 'product-card'} key={type}>
                    <input
                      {...typeField}
                      className="product-card__input"
                      onChange={(event) => {
                        typeField.onChange(event);
                        createAccount.reset();
                      }}
                      type="radio"
                      value={type}
                    />
                    <span className="eyebrow">{content.eyebrow}</span>
                    <strong>{type}</strong>
                    <span>{content.summary}</span>
                  </label>
                );
              })}
            </div>
            <Field label="Account nickname" error={form.formState.errors.nickname?.message}>
              <input
                {...nicknameField}
                onChange={(event) => {
                  nicknameField.onChange(event);
                  createAccount.reset();
                }}
                placeholder={selectedType === 'Checking' ? 'Everyday Checking' : selectedType === 'Savings' ? 'Rainy Day Savings' : 'Travel Credit'}
              />
            </Field>
            <Button disabled={createAccount.isPending} type="submit">
              {createAccount.isPending ? 'Opening account...' : `Open ${selectedType.toLowerCase()} account`}
            </Button>
          </form>
        </Card>
        <Card className="account-open-summary">
          <div className="stack-lg">
            <div className="stack-sm">
              <p className="eyebrow">{selectedContent.eyebrow}</p>
              <h3>{selectedType} account</h3>
              <p className="muted">{selectedContent.summary}</p>
            </div>
            <div className="stack-md">
              <div className="summary-row">
                <div className="summary-row__primary">
                  <strong>Availability</strong>
                  <span className="muted">Appears immediately across your dashboard and account list after opening.</span>
                </div>
              </div>
              <div className="summary-row">
                <div className="summary-row__primary">
                  <strong>Routing details</strong>
                  <span className="muted">{selectedContent.detail}</span>
                </div>
              </div>
              <div className="summary-row">
                <div className="summary-row__primary">
                  <strong>Starting balance</strong>
                  <span className="muted">New accounts start at $0.00 and can be closed later if all balances and pending activity are clear.</span>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

export function AccountDetailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { accountId = '' } = useParams();
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const {
    data: account,
    isLoading: accountLoading,
    refetch: refetchAccount,
  } = useQuery({ queryKey: queryKeys.account(accountId), queryFn: () => accountsService.get(accountId) });
  const { data: transactions = [] } = useQuery({ queryKey: queryKeys.transactions(), queryFn: transactionsService.list });
  const closeAccount = useMutation({
    mutationFn: accountsService.close,
    onSuccess: async () => {
      if (!account) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.accounts() });
      queryClient.removeQueries({ queryKey: queryKeys.account(accountId) });
      navigate('/app/accounts', {
        state: {
          closedAccountName: account.nickname,
        } satisfies AccountsNavigationState,
      });
    },
    onError: async (error) => {
      setCloseError(error instanceof Error ? error.message : 'Unable to close account.');
      await refetchAccount();
    },
  });

  if (accountLoading) {
    return (
      <div className="stack-xl">
        <PageHeader title="Account" eyebrow="Loading" subtitle="Fetching account details..." />
        <div className="grid-two">
          <Card className="account-card account-card--skeleton"><span className="skeleton-block skeleton-block--lg" /></Card>
          <Card className="account-card account-card--skeleton"><span className="skeleton-block skeleton-block--lg" /></Card>
        </div>
      </div>
    );
  }

  if (!account) {
    return <EmptyState title="Account not found" description="Choose another active account from the account summary page." />;
  }

  const accountTheme = getAccountDetailTheme(account.type);
  const accountTransactions = transactions
    .filter((transaction) => transaction.accountId === account.id)
    .slice(0, 8);

  return (
    <div className="stack-xl">
      <PageHeader
        title={account.nickname}
        eyebrow={`${account.type} account`}
        subtitle={`${account.maskedNumber || '••••'} • Routing ${account.routingNumber || 'N/A'}`}
        actions={(
          <div className="account-detail-header-actions">
            <Link className="button button--secondary" to="/app/accounts">Back to accounts</Link>
            <Button
              onClick={() => {
                setCloseError(null);
                setIsCloseDialogOpen(true);
              }}
              type="button"
              variant="destructive"
            >
              Close account
            </Button>
          </div>
        )}
      />
      <Card className={accountTheme.className}>
        <div className="account-hero__top">
          <div className="stack-sm">
            <p className="eyebrow">{account.type} account</p>
            <h2>{account.nickname}</h2>
            <p className="muted">{accountTheme.label}</p>
          </div>
        </div>
        <div className="account-hero__metrics">
          <div className="account-hero__metric account-hero__metric--primary">
            <span>Current balance</span>
            <strong>{formatCurrency(account.balances.currentBalance)}</strong>
          </div>
          <div className="account-hero__metric">
            <span>Available balance</span>
            <strong>{formatCurrency(account.balances.availableBalance)}</strong>
          </div>
          <div className="account-hero__meta">
            <div>
              <span>Opened</span>
              <strong>{formatDate(account.openedAt)}</strong>
            </div>
            <div>
              <span>Account number</span>
              <strong>{account.maskedNumber || '••••'}</strong>
            </div>
            <div>
              <span>Routing</span>
              <strong>{account.routingNumber || 'N/A'}</strong>
            </div>
          </div>
        </div>
        <div className="account-hero__actions">
          <Link className="button button--secondary" to={`/app/transfers?fromAccountId=${account.id}`}>Transfer</Link>
          <Link className="button button--secondary" to={`/app/bill-pay?accountId=${account.id}`}>Pay bill</Link>
          <Link className="button button--secondary" to={`/app/deposits?accountId=${account.id}`}>Deposit check</Link>
          <Link className="button button--ghost" to={`/app/transactions?accountId=${account.id}`}>View statements</Link>
        </div>
      </Card>
      {accountTransactions.length ? (
        <Card className="activity-feed-card">
          <div className="section-heading">
            <div className="stack-sm">
              <p className="eyebrow">Recent activity</p>
              <h3>Latest transactions</h3>
            </div>
            <Link className="text-link" to={`/app/transactions?accountId=${account.id}`}>See full statement</Link>
          </div>
          <div className="activity-feed">
            {accountTransactions.map((transaction) => (
              <div className="activity-item" key={transaction.id}>
                <div
                  aria-hidden="true"
                  className={transaction.direction === 'credit' ? 'activity-item__icon activity-item__icon--credit' : 'activity-item__icon activity-item__icon--debit'}
                >
                  {transaction.direction === 'credit' ? '+' : '−'}
                </div>
                <div className="activity-item__content">
                  <div className="activity-item__primary">
                    <strong>{transaction.description}</strong>
                    <span>
                      {transaction.type} • {transaction.direction === 'credit' ? 'Money in' : 'Money out'}
                    </span>
                  </div>
                  <div className="activity-item__secondary">
                    <span>{formatDate(transaction.postedAt)}</span>
                    <StatusChip status={transaction.status} />
                  </div>
                </div>
                <div className={transaction.direction === 'credit' ? 'activity-item__amount activity-item__amount--credit' : 'activity-item__amount activity-item__amount--debit'}>
                  {transaction.direction === 'credit' ? '+' : '-'}{formatCurrency(transaction.amount)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card className="account-activity-empty">
          <EmptyState
            title="No recent activity yet"
            description="This account is set up and ready to use. As soon as you move money, pay a bill, or submit a deposit, activity will appear here."
          />
        </Card>
      )}
      {closeError ? (
        <InlineAlert title="Unable to close account" tone="warning">
          {closeError}
        </InlineAlert>
      ) : null}
      <Dialog
        actions={(
          <>
            <Button
              onClick={() => {
                if (closeAccount.isPending) return;
                setIsCloseDialogOpen(false);
              }}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={closeAccount.isPending || !account.canClose}
              onClick={() => {
                closeAccount.mutate(account.id);
              }}
              type="button"
              variant="destructive"
            >
              {!account.canClose ? 'Close unavailable' : closeAccount.isPending ? 'Closing account...' : 'Confirm close'}
            </Button>
          </>
        )}
        description={
          account.canClose
            ? 'This removes the account from your active dashboard. You will keep the historical record, but the account can no longer be used for new activity.'
            : 'This account cannot be closed yet. Review the blocking reason below.'
        }
        onClose={() => {
          if (closeAccount.isPending) return;
          setIsCloseDialogOpen(false);
        }}
        open={isCloseDialogOpen}
        title={account.canClose ? `Close ${account.nickname}?` : `Can't close ${account.nickname}`}
      >
        <div className="stack-sm">
          {!account.canClose ? (
            <InlineAlert title="Account not eligible for closure" tone="warning">
              {account.closeReasons.length ? account.closeReasons.join(' ') : 'This account still has blocking activity.'}
            </InlineAlert>
          ) : null}
          <div className="summary-row">
            <div className="summary-row__primary">
              <strong>{account.nickname}</strong>
              <span className="muted">{account.type} • {account.maskedNumber || '••••'}</span>
            </div>
          </div>
          <div className="summary-row">
            <div className="summary-row__primary">
              <strong>Available balance</strong>
            </div>
            <div className="summary-row__secondary">
              <strong>{formatCurrency(account.balances.availableBalance)}</strong>
            </div>
          </div>
          <div className="summary-row">
            <div className="summary-row__primary">
              <strong>Current balance</strong>
            </div>
            <div className="summary-row__secondary">
              <strong>{formatCurrency(account.balances.currentBalance)}</strong>
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
