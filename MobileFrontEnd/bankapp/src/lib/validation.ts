export function parseMoneyInput(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
}

export function hasEnoughAvailableBalance(availableBalance: number | undefined, amount: number): boolean {
  if (typeof availableBalance !== "number" || !Number.isFinite(availableBalance)) return false;
  return Math.round(availableBalance * 100) >= Math.round(amount * 100);
}

export function isDigits(value: string): boolean {
  return /^\d+$/.test(value);
}

export function isDateInputValue(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function isOnOrAfterDate(value: string, minDate: string): boolean {
  return isDateInputValue(value) && value >= minDate;
}

export function isTimeInputValue(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
