export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

export function formatDate(value: string): string {
  if (!value) return '—';
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsedDate = dateOnlyMatch
    ? new Date(Number(dateOnlyMatch[1]), Number(dateOnlyMatch[2]) - 1, Number(dateOnlyMatch[3]))
    : new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsedDate);
}

export function formatDateTime(value: string): string {
  if (!value) return '—';
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsedDate);
}

export function formatTime(value: string): string {
  if (!value) return '—';
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsedDate);
}

export function formatDateTimeInTimezone(value: string, timezone: string): string {
  if (!value) return '—';
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone || 'UTC',
    }).format(parsedDate);
  } catch {
    return formatDateTime(value);
  }
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
