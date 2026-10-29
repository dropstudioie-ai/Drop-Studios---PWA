// Studio-local date/time helpers. All business dates are evaluated in the
// studio timezone (Europe/Dublin), matching the database functions.
export const STUDIO_TZ = 'Europe/Dublin';
export const LOCALE = 'en-IE';

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' for the given instant as seen in the studio timezone. */
export function localDateKey(date: Date, tz = STUDIO_TZ): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Adds whole days to a 'YYYY-MM-DD' key (calendar arithmetic, DST-safe). */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive number of days between two date keys (end - start + 1). */
export function daysInclusive(startKey: string, endKey: string): number {
  return diffDays(startKey, endKey) + 1;
}

export function diffDays(fromKey: string, toKey: string): number {
  const toUtc = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(toKey) - toUtc(fromKey)) / DAY_MS);
}

/** ISO weekday (1 = Monday … 7 = Sunday) of a date key. */
export function isoWeekday(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Monday of the week containing the date key. */
export function weekStartKey(key: string): string {
  return addDaysToKey(key, 1 - isoWeekday(key));
}

function tzOffsetMs(instant: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The instant at which the studio's wall clock reads `key` 00:00 + minutes. */
export function zonedTime(key: string, minutes = 0, tz = STUDIO_TZ): Date {
  const [y, m, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d) + minutes * 60_000;
  let result = guess - tzOffsetMs(guess, tz);
  result = guess - tzOffsetMs(result, tz);
  return new Date(result);
}

export const fmt = {
  time: (d: Date | string, tz = STUDIO_TZ) =>
    new Intl.DateTimeFormat(LOCALE, { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d)),
  date: (d: Date | string, tz = STUDIO_TZ) =>
    new Intl.DateTimeFormat(LOCALE, { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d)),
  dayMonth: (d: Date | string, tz = STUDIO_TZ) =>
    new Intl.DateTimeFormat(LOCALE, { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(d)),
  weekdayLong: (d: Date | string, tz = STUDIO_TZ) =>
    new Intl.DateTimeFormat(LOCALE, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d)),
  dateTime: (d: Date | string, tz = STUDIO_TZ) =>
    new Intl.DateTimeFormat(LOCALE, { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d)),
};

/** Formats a 'YYYY-MM-DD' key without timezone drift. */
export function formatKey(key: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Intl.DateTimeFormat(LOCALE, { ...opts, timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));
}
