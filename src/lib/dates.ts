/**
 * Every reporting boundary is Asia/Kolkata. Never use the browser's timezone
 * or `new Date().getMonth()` for ledger math.
 */

export const IST = "Asia/Kolkata";

const yearMonthFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST,
  year: "numeric",
  month: "2-digit",
});

/** '2026-11' for the given instant, in IST. */
export function yearMonthInIst(date: Date | number): string {
  const d = typeof date === "number" ? new Date(date) : date;
  const parts = yearMonthFormatter.formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

/** '2026-11' -> 'Nov 2026' */
export function formatYearMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  if (!year || !month) return yearMonth;
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/**
 * Credit-card cycle window: [statementDay of the previous month, statementDay
 * of this month), evaluated in IST. `statementDay` is clamped to the month's
 * last day so a 31st statement day still works in February.
 */
const dayMonthFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: IST,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

/** '26 Nov 2026' in IST, for a ledger row. */
export function formatDateInIst(date: Date): string {
  return dayMonthFormatter.format(date);
}

/**
 * `datetime-local` sends wall-clock text with no zone. The owner types IST, so
 * the server reads it as IST and stores a real instant.
 */
export function parseIstDateTime(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  if (!year || !month || !day) return null;
  const utcMs =
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour ?? "0"), Number(minute ?? "0")) -
    5.5 * 60 * 60 * 1000;
  return new Date(utcMs);
}

/** The current instant as IST wall-clock text for a `datetime-local` default. */
export function toDatetimeLocalIst(date: Date): string {
  const shifted = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

/**
 * The cycle that contains `now`: from the most recent statement date up to the
 * next one. Before the statement day the cycle started last month.
 */
export function currentCardCycle(
  statementDay: number,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const [year, month] = yearMonthInIst(now).split("-").map(Number);
  const y = year ?? 1970;
  const m = month ?? 1;

  const thisStart = istDate(y, m, statementDay);
  const nextStart = m === 12 ? istDate(y + 1, 1, statementDay) : istDate(y, m + 1, statementDay);
  const prevStart = m === 1 ? istDate(y - 1, 12, statementDay) : istDate(y, m - 1, statementDay);

  return now >= thisStart
    ? { start: thisStart, end: nextStart }
    : { start: prevStart, end: thisStart };
}

export function cardCycleWindow(yearMonth: string, statementDay: number): { start: Date; end: Date } {
  const [year, month] = yearMonth.split("-").map(Number);
  if (!year || !month) throw new Error(`Invalid yearMonth: ${yearMonth}`);

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const start = istDate(prevYear, prevMonth, statementDay);
  const end = istDate(year, month, statementDay);
  return { start, end };
}

/** Midnight IST on the given date, as a UTC Date. */
export function istDate(year: number, month: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const clamped = Math.min(Math.max(day, 1), lastDay);
  // IST is UTC+05:30 with no DST, so midnight IST is 18:30 UTC the day before.
  return new Date(Date.UTC(year, month - 1, clamped, 0, 0) - 5.5 * 60 * 60 * 1000);
}
