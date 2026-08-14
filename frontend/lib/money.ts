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

/**
 * EUR amount, with a rounded Lek equivalent appended when the business
 * display currency is set to ALL (e.g. "€30 (2,760 L)"). Storage stays EUR
 * cents everywhere; this is display-only, for Fleet/Invoice/Customer money
 * -- NOT formatEur's other callers (Finance, Reservations, Dashboard), which
 * stay EUR-only.
 */
export function formatMoneyDisplay(
  cents: number | null | undefined,
  currency: string,
  rate: number
): string {
  const eur = formatEur(cents);
  if (currency !== "ALL") return eur;
  const lek = Math.round(((cents || 0) / 100) * rate);
  return `${eur} (${lek.toLocaleString("en-US")} L)`;
}
