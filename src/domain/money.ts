/** EUR formatting for Ireland: €35, €49.50. */
export function formatPrice(cents: number, currency = 'EUR', opts: { forceDecimals?: boolean } = {}): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
    minimumFractionDigits: whole && !opts.forceDecimals ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Parses a user-entered euro amount ("49", "49.5", "€49,50") into cents. */
export function parseEurosToCents(input: string): number | null {
  const cleaned = input.replace(/[€\s]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
