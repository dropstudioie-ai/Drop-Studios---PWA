import { describe, expect, it } from 'vitest';
import { generateOptions, pickMood } from './generate';

describe('event design options', () => {
  it('reads the theme to pick a style', () => {
    expect(pickMood('Halloween FitDance').name).toBe('Spooky');
    expect(pickMood('All Black Friday class').name).toBe('All black');
    expect(pickMood('Just a class').name).toBe('Drop');
  });
  it('makes four editable options using the photos and keeps the event link', () => {
    const ds = generateOptions({ title: 'Neon Night', kicker: 'Special themed class', date: 'Friday 28 November', time: '18:30', instructor: 'Talita', description: 'Glow sticks!', dressCode: 'Neon', price: '', look: '', photos: [{ src: '/a.webp', width: 900, height: 1600 }], format: 'ig-portrait', eventId: 'ev1' });
    expect(ds).toHaveLength(4);
    for (const d of ds) {
      expect(d.dropEventId).toBe('ev1');
      expect(d.pages[0].elements.some((e) => e.type === 'image' && e.src === '/a.webp')).toBe(true);
      expect(d.pages[0].elements.some((e) => e.type === 'text' && /neon night/i.test(e.text))).toBe(true);
    }
  });
});
