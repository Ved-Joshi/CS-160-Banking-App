import clsx from 'clsx';
import { useEffect, useId, useRef, type PropsWithChildren, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
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
  className,
  style,
}: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className={clsx('page-header', className)} style={style}>
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
}: PropsWithChildren<{ label: ReactNode; error?: string }>) {
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

export function Dialog({
  open,
  title,
  description,
  children,
  actions,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const getFocusable = () =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>(focusSelector) ?? []).filter(
        (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1,
      );

    const frame = requestAnimationFrame(() => {
      getFocusable()[0]?.focus();
    });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = getFocusable();
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActive?.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div aria-labelledby={titleId} aria-modal="true" className="dialog" ref={panelRef} role="dialog">
        <div className="dialog__header">
          <div className="stack-sm">
            <h3 id={titleId}>{title}</h3>
            {description ? <p className="muted">{description}</p> : null}
          </div>
          <button aria-label="Close dialog" className="dialog__close" onClick={onClose} type="button">
            ×
          </button>
        </div>
        {children ? <div className="dialog__body">{children}</div> : null}
        {actions ? <div className="dialog__actions">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
