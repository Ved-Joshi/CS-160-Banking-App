import { describe, expect, it } from 'vitest';
import { formatCurrency, formatDate, titleCase } from './format';

describe('format utilities', () => {
  it('formats usd values', () => {
    expect(formatCurrency(142.87)).toBe('$142.87');
  });

  it('converts status strings to title case', () => {
    expect(titleCase('PENDING_REVIEW')).toBe('Pending Review');
  });

  it('formats date-only values without timezone day shift', () => {
    expect(formatDate('2026-04-22')).toBe('Apr 22, 2026');
  });
});
