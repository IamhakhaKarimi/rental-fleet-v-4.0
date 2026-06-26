/**
 * format_eur — exact port of ui/components.format_eur.
 * Money is integer cents end-to-end. Drop the decimals when they're zero
 * (3000 -> "€30", 3050 -> "€30.50", -3050 -> "-€30.50"); "€0" for 0/None.
 */
export function formatEur(cents: number | null | undefined): string {
  if (!cents) return "€0";
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const rem = abs % 100;
  const wholeStr = whole.toLocaleString("en-US");
  const body = rem === 0 ? `€${wholeStr}` : `€${wholeStr}.${String(rem).padStart(2, "0")}`;
  return neg ? `-${body}` : body;
}

/** euros (number) -> integer cents, for form inputs. */
export function toCents(euros: number): number {
  return Math.round(euros * 100);
}
