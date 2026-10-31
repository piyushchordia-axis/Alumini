import { zonedWallTimeToUtc, type BillingCycle } from "@illuminize/shared";

/** A billing period: inclusive calendar days in a time zone, plus the instants they span. */
export interface BillingPeriod {
  fromDay: string;
  toDay: string;
  timeZone: string;
  from: Date;
  toExclusive: Date;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayString = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return dayString(d);
}

/** Today's calendar date in the zone. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The calendar month containing `now`, in the zone. */
export function currentMonth(timeZone: string, now = new Date()): { fromDay: string; toDay: string } {
  const [y, m] = todayIn(timeZone, now).split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { fromDay: `${y}-${pad(m)}-01`, toDay: `${y}-${pad(m)}-${pad(last)}` };
}

export function billingPeriod(fromDay: string, toDay: string, timeZone: string): BillingPeriod {
  const from = new Date(zonedWallTimeToUtc(`${fromDay}T00:00`, timeZone)!);
  const toExclusive = new Date(zonedWallTimeToUtc(`${addDays(toDay, 1)}T00:00`, timeZone)!);
  return { fromDay, toDay, timeZone, from, toExclusive };
}

/**
 * Length of an inclusive day range in months, counting each calendar month it touches as the fraction of that
 * month's days it covers: 1 for any full calendar month, 3 for a full quarter, 15/30 for half of June.
 */
export function monthsInPeriod(fromDay: string, toDay: string): number {
  let months = 0;
  let cursor = parseDay(fromDay);
  const end = parseDay(toDay);
  while (cursor <= end) {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const monthEnd = new Date(Date.UTC(y, m, daysInMonth));
    const sliceEnd = monthEnd < end ? monthEnd : end;
    const days = Math.round((sliceEnd.getTime() - cursor.getTime()) / 86_400_000) + 1;
    months += days / daysInMonth;
    cursor = new Date(Date.UTC(y, m + 1, 1));
  }
  return months;
}

const CYCLE_MONTHS: Record<BillingCycle, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

/** Share of one billing cycle the period covers (a month on a quarterly plan is 1/3). */
export function cycleFraction(fromDay: string, toDay: string, cycle: BillingCycle): number {
  return monthsInPeriod(fromDay, toDay) / CYCLE_MONTHS[cycle];
}
