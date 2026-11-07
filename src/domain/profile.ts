import { localDateKey } from './time';

/** A plausible date of birth as 'YYYY-MM-DD' (not in the future, not before 1900). */
export const validDob = (v: string, today = localDateKey(new Date())) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= '1900-01-01' && v <= today;
