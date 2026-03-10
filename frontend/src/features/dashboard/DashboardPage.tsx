import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, InlineAlert, PageHeader, StatusChip } from '../../components/ui';
import { accountsService, billPayService, depositsService, transactionsService } from '../../lib/mockApi';
import { formatCurrency, formatDate } from '../../lib/format';
import { useAuth } from '../auth/useAuth';

export function DashboardPage() {
  const { user } = useAuth();
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: accountsService.list });
  const { data: transactions = [] } = useQuery({ queryKey: ['transactions'], queryFn: transactionsService.list });
  const { data: payments = [] } = useQuery({ queryKey: ['payments'], queryFn: billPayService.listPayments });
  const { data: deposits = [] } = useQuery({ queryKey: ['deposits'], queryFn: depositsService.list });

  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || accounts[0]?.nickname || 'Welcome';
  const totalAvailable = accounts.reduce((sum, account) => sum + account.balances.availableBalance, 0);
  const recentTransactions = transactions.slice(0, 4);
  const pendingDeposit = deposits.find((deposit) => deposit.status === 'PENDING_REVIEW');

  return (
    <div className="stack-xl">
      <PageHeader
        eyebrow="Account overview"
        title={`Welcome, ${displayName}!`}
        subtitle="See balances, recent activity, and the items that still need your attention."
      />
      {pendingDeposit ? (
        <InlineAlert title="Deposit pending review" tone="warning">
          Your deposit for {formatCurrency(pendingDeposit.amount)} was submitted on {formatDate(pendingDeposit.submittedAt)}.
        </InlineAlert>
      ) : null}
      <div className="hero-balance card">
        <div>
          <p className="eyebrow">Available across linked accounts</p>
          <h2>{formatCurrency(totalAvailable)}</h2>
        </div>
        <div className="button-row">
          <Link className="button button--secondary" to="/app/transfers">
            Transfer money
          </Link>
          <Link className="button button--secondary" to="/app/bill-pay">
            Pay bills
          </Link>
          <Link className="button button--secondary" to="/app/deposits">
            Deposit check
          </Link>
        </div>
      </div>
      <div className="grid-three">
        {accounts.map((account) => (
          <Card key={account.id}>
            <p className="eyebrow">{account.type}</p>
            <h3>{account.nickname}</h3>
            <p className="muted">{account.maskedNumber}</p>
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
            <Link className="text-link" to={`/app/accounts/${account.id}`}>
              View account
            </Link>
          </Card>
        ))}
      </div>
      <div className="dashboard-grid">
        <Card>
          <div className="section-heading">
            <h3>Recent transactions</h3>
            <Link className="text-link" to="/app/transactions">
              See all
            </Link>
          </div>
          <div className="list-stack">
            {recentTransactions.map((transaction) => (
              <div className="summary-row" key={transaction.id}>
                <div className="summary-row__primary">
                  <strong>{transaction.description}</strong>
                  <p className="muted">{formatDate(transaction.postedAt)}</p>
                </div>
                <div className="summary-row__secondary">
                  <strong>{transaction.direction === 'credit' ? '+' : '-'}{formatCurrency(transaction.amount)}</strong>
                  <StatusChip status={transaction.status} />
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="section-heading">
            <h3>Upcoming bill payments</h3>
            <Link className="text-link" to="/app/bill-pay">
              Manage
            </Link>
          </div>
          <div className="list-stack">
            {payments.slice(0, 4).map((payment) => (
              <div className="summary-row" key={payment.id}>
                <div className="summary-row__primary">
                  <strong>{payment.payeeName}</strong>
                  <p className="muted">Deliver by {formatDate(payment.deliverBy)}</p>
                </div>
                <div className="summary-row__secondary">
                  <strong>{formatCurrency(payment.amount)}</strong>
                  <StatusChip status={payment.status} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
