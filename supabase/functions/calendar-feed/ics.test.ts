import { assert, assertStringIncludes } from 'jsr:@std/assert@1';
import { icsCalendar } from './ics.ts';

Deno.test('calendar feed: classes orange, rentals blue, valid iCalendar', () => {
  const ics = icsCalendar('Drop Studios', 'orange', [
    { id: 'class-1', type: 'class', starts_at: '2026-11-23T18:00:00Z', ends_at: '2026-11-23T19:00:00Z', title: 'Choreography', detail: 'Vini Martins · 5/20 booked' },
    { id: 'rental-2', type: 'rental', starts_at: '2026-11-29T16:00:00Z', ends_at: '2026-11-29T20:00:00Z', title: 'Rental: Zouk team', detail: 'Ana, 087 123 4567; paid' },
  ], '2026-11-17T12:00:00Z');
  assert(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assertStringIncludes(ics, 'DTSTART:20261123T180000Z');
  assertStringIncludes(ics, 'SUMMARY:Rental: Zouk team\r\nCOLOR:blue');
  assertStringIncludes(ics, 'SUMMARY:Choreography\r\nCOLOR:orange');
  assertStringIncludes(ics, 'DESCRIPTION:Ana\\, 087 123 4567\; paid');
  for (const line of ics.split('\r\n')) assert(new TextEncoder().encode(line).length <= 75, line);
});
