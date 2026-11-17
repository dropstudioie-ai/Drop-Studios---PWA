// Builds an iCalendar (.ics) feed. Classes are orange, rentals blue (RFC 7986 COLOR, shown by apps that support it;
// otherwise the colour is the one chosen for the subscribed calendar).
export interface CalEvent { id: string; type: 'class' | 'rental'; starts_at: string; ends_at: string; title: string; detail: string | null }

const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Lines longer than 75 octets are folded (RFC 5545). */
const fold = (line: string) => {
  const out: string[] = []; let rest = line;
  while (new TextEncoder().encode(rest).length > 75) { let cut = 74; while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut--; out.push(rest.slice(0, cut)); rest = ' ' + rest.slice(cut); }
  out.push(rest);
  return out.join('\r\n');
};

export function icsCalendar(name: string, color: string, events: CalEvent[], now = new Date().toISOString()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Drop Studios//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`, `NAME:${esc(name)}`, `COLOR:${color}`, 'X-WR-TIMEZONE:Europe/Dublin',
    'REFRESH-INTERVAL;VALUE=DURATION:PT5M', 'X-PUBLISHED-TTL:PT5M'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@dropstudios.ie`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(e.starts_at)}`, `DTEND:${stamp(e.ends_at)}`,
      `SUMMARY:${esc(e.title)}`, `COLOR:${e.type === 'rental' ? 'blue' : 'orange'}`, `CATEGORIES:${e.type === 'rental' ? 'Studio rental' : 'Drop class'}`,
      ...(e.detail ? [`DESCRIPTION:${esc(e.detail)}`] : []), 'LOCATION:Drop Studios\\, 13 Sackville Place\\, Dublin 1', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
