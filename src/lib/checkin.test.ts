import { describe, expect, it } from 'vitest';
import { checkinPathFromQr } from './checkin';

describe('checkinPathFromQr', () => {
  it('accepts check-in codes from any Drop address', () => {
    expect(checkinPathFromQr('https://www.dropstudios.ie/checkin?s=abc&t=123')).toBe('/checkin?s=abc&t=123');
    expect(checkinPathFromQr('https://dropstudios.ie/checkin?studio=1&t=9')).toBe('/checkin?studio=1&t=9');
    expect(checkinPathFromQr('https://drop-studios-pwa.vercel.app/checkin/?s=a&t=1')).toBe('/checkin?s=a&t=1');
  });
  it('rejects other codes', () => {
    expect(checkinPathFromQr('https://evil.example.com/checkin?s=a&t=1')).toBeNull();
    expect(checkinPathFromQr('https://www.dropstudios.ie/timetable')).toBeNull();
    expect(checkinPathFromQr('hello')).toBeNull();
  });
});
