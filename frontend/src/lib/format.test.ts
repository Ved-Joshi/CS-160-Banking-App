import { describe, expect, it } from 'vitest';
import { formatCurrency, titleCase } from './format';

describe('format utilities', () => {
  it('formats usd values', () => {
    expect(formatCurrency(142.87)).toBe('$142.87');
  });

  it('converts status strings to title case', () => {
    expect(titleCase('PENDING_REVIEW')).toBe('Pending Review');
  });
});
