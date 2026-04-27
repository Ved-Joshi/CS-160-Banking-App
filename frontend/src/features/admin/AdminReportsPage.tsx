import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, DataTable, InlineAlert, PageHeader, StatusChip } from '../../components/ui';
import { adminReportsService } from '../../lib/bankingApi';
import { formatCurrency, formatDate } from '../../lib/format';
import type { AdminAccountReportResponse } from '../../types/banking';

type ReportFilters = {
  search: string;
  minBalance: string;
  maxBalance: string;
  zipCode: string;
  city: string;
  state: string;
  accountType: 'all' | 'checking' | 'savings' | 'credit';
  status: 'all' | 'open' | 'restricted';
  limit: string;
};

const defaultFilters: ReportFilters = {
  search: '',
  minBalance: '',
  maxBalance: '',
  zipCode: '',
  city: '',
  state: '',
  accountType: 'all',
  status: 'all',
  limit: '1000',
};

const emptyReport: AdminAccountReportResponse = {
  rows: [],
  summary: {
    totalAccounts: 0,
    distinctCustomers: 0,
    openAccounts: 0,
    restrictedAccounts: 0,
    totalCurrentBalance: 0,
    averageCurrentBalance: 0,
  },
};

function toOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildCsvCell(value: string | number): string {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function AdminReportsPage() {
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters);
  const [report, setReport] = useState<AdminAccountReportResponse>(emptyReport);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string>('');

  const runReport = useCallback(async (activeFilters: ReportFilters) => {
    setLoading(true);
    setError('');
    try {
      const data = await adminReportsService.accountReport({
        search: activeFilters.search,
        minBalance: toOptionalNumber(activeFilters.minBalance),
        maxBalance: toOptionalNumber(activeFilters.maxBalance),
        zipCode: activeFilters.zipCode,
        city: activeFilters.city,
        state: activeFilters.state,
        accountType: activeFilters.accountType === 'all' ? undefined : activeFilters.accountType,
        status: activeFilters.status === 'all' ? undefined : activeFilters.status,
        limit: toOptionalNumber(activeFilters.limit),
      });
      setReport(data);
      setLastGeneratedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate report.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runReport(defaultFilters);
  }, [runReport]);

  const csvContent = useMemo(() => {
    const headers = [
      'Customer Name',
      'Customer Email',
      'Customer ID',
      'Account ID',
      'Nickname',
      'Masked Number',
      'Type',
      'Status',
      'Current Balance',
      'Available Balance',
      'ZIP Code',
      'City',
      'State',
      'Opened At',
    ];
    const rows = report.rows.map((row) => [
      row.customerName,
      row.customerEmail,
      row.customerId,
      row.accountId,
      row.accountNickname,
      row.maskedNumber,
      row.accountType,
      row.accountStatus,
      row.currentBalance,
      row.availableBalance,
      row.zipCode,
      row.city,
      row.state,
      row.openedAt,
    ]);
    return [headers, ...rows].map((line) => line.map((cell) => buildCsvCell(cell)).join(',')).join('\n');
  }, [report.rows]);

  const handleExportCsv = () => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateSuffix = new Date().toISOString().slice(0, 10);
    link.href = objectUrl;
    link.download = `admin-account-report-${dateSuffix}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  return (
    <div className="stack-xl" style={{ paddingTop: '1rem' }}>
      <PageHeader
        title="Reporting Dashboard"
        eyebrow="Admin panel"
        subtitle="Query accounts and customers by attributes, then export report-ready results."
        actions={(
          <div className="button-row" style={{ justifyContent: 'flex-end' }}>
            <Link className="button button--secondary" to="/admin">Back to panel</Link>
            <button className="button button--primary" type="button" onClick={() => { void runReport(filters); }}>
              Generate report
            </button>
          </div>
        )}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          margin: '0 auto',
          width: '100%',
        }}
      />

      {error ? <InlineAlert title="Error" tone="warning">{error}</InlineAlert> : null}

      <Card>
        <div className="stack-md">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
              gap: '0.8rem',
            }}
          >
            <label className="field">
              <span>Search</span>
              <input
                placeholder="Customer, email, account id..."
                value={filters.search}
                onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Min balance</span>
              <input
                inputMode="decimal"
                placeholder="0"
                value={filters.minBalance}
                onChange={(event) => setFilters((prev) => ({ ...prev, minBalance: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>Max balance</span>
              <input
                inputMode="decimal"
                placeholder="50000"
                value={filters.maxBalance}
                onChange={(event) => setFilters((prev) => ({ ...prev, maxBalance: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>ZIP code</span>
              <input
                placeholder="e.g. 941"
                value={filters.zipCode}
                onChange={(event) => setFilters((prev) => ({ ...prev, zipCode: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>City</span>
              <input
                placeholder="San Francisco"
                value={filters.city}
                onChange={(event) => setFilters((prev) => ({ ...prev, city: event.target.value }))}
              />
            </label>
            <label className="field">
              <span>State (2-letter)</span>
              <input
                maxLength={2}
                placeholder="CA"
                value={filters.state}
                onChange={(event) => setFilters((prev) => ({ ...prev, state: event.target.value.toUpperCase() }))}
              />
            </label>
            <label className="field">
              <span>Account type</span>
              <select
                value={filters.accountType}
                onChange={(event) => setFilters((prev) => ({ ...prev, accountType: event.target.value as ReportFilters['accountType'] }))}
              >
                <option value="all">All types</option>
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="credit">Credit</option>
              </select>
            </label>
            <label className="field">
              <span>Status</span>
              <select
                value={filters.status}
                onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value as ReportFilters['status'] }))}
              >
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="restricted">Restricted</option>
              </select>
            </label>
            <label className="field">
              <span>Result limit</span>
              <input
                inputMode="numeric"
                placeholder="1000"
                value={filters.limit}
                onChange={(event) => setFilters((prev) => ({ ...prev, limit: event.target.value }))}
              />
            </label>
          </div>
          <div className="button-row" style={{ justifyContent: 'space-between' }}>
            <p className="muted">
              {lastGeneratedAt ? `Last generated ${formatDate(lastGeneratedAt)}` : 'Generate a report to see results.'}
            </p>
            <div className="button-row">
              <button
                className="button button--secondary"
                type="button"
                onClick={() => {
                  setFilters(defaultFilters);
                  void runReport(defaultFilters);
                }}
              >
                Reset filters
              </button>
              <button className="button button--secondary" disabled={!report.rows.length} type="button" onClick={handleExportCsv}>
                Export CSV
              </button>
            </div>
          </div>
        </div>
      </Card>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
          gap: '0.8rem',
        }}
      >
        <Card>
          <p className="eyebrow">Accounts</p>
          <h3>{report.summary.totalAccounts}</h3>
        </Card>
        <Card>
          <p className="eyebrow">Customers</p>
          <h3>{report.summary.distinctCustomers}</h3>
        </Card>
        <Card>
          <p className="eyebrow">Open / Restricted</p>
          <h3>{report.summary.openAccounts} / {report.summary.restrictedAccounts}</h3>
        </Card>
        <Card>
          <p className="eyebrow">Total balance</p>
          <h3>{formatCurrency(report.summary.totalCurrentBalance)}</h3>
        </Card>
        <Card>
          <p className="eyebrow">Average balance</p>
          <h3>{formatCurrency(report.summary.averageCurrentBalance)}</h3>
        </Card>
      </div>

      <Card>
        <div className="stack-md">
          {loading ? <p>Generating report...</p> : null}
          {!loading && !report.rows.length ? <p className="muted">No matching records found for this query.</p> : null}
          {!loading && report.rows.length ? (
            <DataTable
              headers={[
                'Customer',
                'ZIP / Location',
                'Account',
                'Type',
                'Status',
                'Current',
                'Available',
                'Opened',
              ]}
              rows={report.rows.map((row) => ([
                <div className="stack-sm" key={`${row.accountId}-customer`}>
                  <strong>{row.customerName}</strong>
                  <span className="muted">{row.customerEmail || row.customerId}</span>
                </div>,
                <div className="stack-sm" key={`${row.accountId}-location`}>
                  <strong>{row.zipCode || '—'}</strong>
                  <span className="muted">{[row.city, row.state].filter(Boolean).join(', ') || '—'}</span>
                </div>,
                <div className="stack-sm" key={`${row.accountId}-account`}>
                  <strong>{row.accountNickname}</strong>
                  <span className="muted">{row.maskedNumber} · {row.accountId.slice(0, 8)}</span>
                </div>,
                row.accountType,
                <StatusChip key={`${row.accountId}-status`} status={row.accountStatus} />,
                formatCurrency(row.currentBalance),
                formatCurrency(row.availableBalance),
                formatDate(row.openedAt),
              ]))}
            />
          ) : null}
        </div>
      </Card>
    </div>
  );
}
