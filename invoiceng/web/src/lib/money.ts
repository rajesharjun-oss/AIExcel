/** Mirror of the server's kobo conventions for display and input parsing. */

export function formatNaira(amountKobo: number): string {
  const naira = Math.floor(amountKobo / 100);
  const kobo = amountKobo % 100;
  const nairaStr = naira.toLocaleString("en-NG");
  return kobo === 0 ? `₦${nairaStr}` : `₦${nairaStr}.${kobo.toString().padStart(2, "0")}`;
}

/**
 * Parse a user-typed naira amount ("12,500", "12500.5", "₦12,500.50") to kobo.
 * Returns null for anything that is not a clean non-negative amount.
 */
export function parseNairaToKobo(input: string): number | null {
  const cleaned = input.replace(/[₦,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [wholeStr = "0", fracStr = ""] = cleaned.split(".");
  const whole = Number(wholeStr);
  const frac = Number((fracStr + "00").slice(0, 2));
  if (!Number.isSafeInteger(whole * 100)) return null;
  return whole * 100 + frac;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

export function isOverdue(inv: { status: string; dueDate: number }, now = Date.now()): boolean {
  return (inv.status === "sent" || inv.status === "part_paid") && inv.dueDate < now;
}
