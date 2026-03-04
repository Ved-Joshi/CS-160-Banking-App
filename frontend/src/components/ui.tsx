import clsx from 'clsx';
import type { PropsWithChildren, ReactNode } from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
}

export function Button({ className, variant = 'primary', ...props }: ButtonProps) {
  return <button className={clsx('button', `button--${variant}`, className)} {...props} />;
}

export function Card({ className, children }: PropsWithChildren<{ className?: string }>) {
  return <section className={clsx('card', className)}>{children}</section>;
}

export function PageHeader({
  title,
  eyebrow,
  subtitle,
  actions,
}: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </div>
  );
}

export function Field({
  label,
  error,
  children,
}: PropsWithChildren<{ label: string; error?: string }>) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {error ? <small className="field-error">{error}</small> : null}
    </label>
  );
}

export function StatusChip({ status }: { status: string }) {
  return <span className={`status-chip status-chip--${status.toLowerCase().replace(/[_\s]+/g, '-')}`}>{status.replace(/_/g, ' ')}</span>;
}

export function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <Card className="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </Card>
  );
}

export function InlineAlert({
  title,
  children,
  tone = 'neutral',
}: PropsWithChildren<{ title: string; tone?: 'neutral' | 'warning' | 'success' }>) {
  return (
    <div className={clsx('inline-alert', `inline-alert--${tone}`)}>
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}
