// End-to-end check of Drop Design in a real browser (Chromium via Playwright).
// Serves the production build and stands in for the Drop server (sign-in, events, artwork upload),
// so it runs offline and never touches real data. Usage: npm run build && npm run e2e
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIST = path.join(__dirname, '..', 'dist');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5199;
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT);

const DROP = 'https://plskvdfcjdxkfiznguzo.supabase.co';
const PROFILES = {
  owner: { id: 'u-owner', full_name: 'Jorge dos Santos', email: 'owner@example.com', role: 'admin', finance_access: true },
  manager: { id: 'u-mgr', full_name: 'Ana Souto', email: 'ana@example.com', role: 'admin', finance_access: false },
  instructor: { id: 'u-ins', full_name: 'Talita Lima', email: 'talita@example.com', role: 'instructor', finance_access: false },
  member: { id: 'u-mem', full_name: 'Some Member', email: 'member@example.com', role: 'customer', finance_access: false },
};
const EVENT = { id: '11111111-2222-3333-4444-555555555555', kind: 'special_class', status: 'published', title: 'Neon FitDance', description: 'Glow sticks and UV lights for a party class.',
  dress_code: 'Neon colours', decorations: null, extras: null, instructor: 'João Zublin', theme: { name: 'Neon night', emoji: '🌈' }, starts_at: null, ends_at: null,
  price_cents: null, member_price_cents: null, artwork_path: null, session: { id: 's1', title: 'FitDance', starts_at: new Date(Date.now() + 5 * 864e5).toISOString(), ends_at: new Date(Date.now() + 5 * 864e5 + 36e5).toISOString() } };

const ONLY = (process.env.ONLY || 'access,editor,templates,drop,invoices,tablet').split(',');
const want = (k) => ONLY.includes(k);
const results = [];
const problems = [];
const check = (name, ok, detail = '') => { results.push([ok ? 'PASS' : 'FAIL', name, detail]); if (!ok) console.log('FAIL', name, detail); };

function makePng(w, h, rgb) {
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const v of b) x = t[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

async function mockDrop(ctx, role, log) {
  await ctx.route(`${DROP}/**`, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    log.push(`${req.method()} ${u.pathname}`);
    const user = { id: PROFILES[role].id, email: PROFILES[role].email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
    if (u.pathname === '/auth/v1/token') {
      const b = JSON.parse(req.postData() || '{}');
      if (b.password !== 'right-password') return json({ error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' }, 400);
      return json({ access_token: 'x.eyJzdWIiOiJ4In0.y', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user });
    }
    if (u.pathname === '/auth/v1/user') return json(user);
    if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
    if (u.pathname === '/rest/v1/profiles') return json(PROFILES[role]);
    if (u.pathname === '/rest/v1/rpc/admin_events' || u.pathname === '/rest/v1/rpc/my_events') return json([EVENT]);
    if (u.pathname.startsWith('/storage/v1/object/event-art/')) return json({ Key: u.pathname.replace('/storage/v1/object/', '') });
    if (u.pathname === '/rest/v1/rpc/set_event_artwork') return route.fulfill({ status: 204 });
    return json([]);
  });
}

(async () => {
  const browser = await chromium.launch();
  const base = `http://localhost:${PORT}`;
  const tmp = path.join(OUT, 'files'); fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'photo.png'), makePng(640, 480, [220, 40, 90]));
  fs.copyFileSync(path.join(__dirname, '..', 'public', 'library', 'drop', 'photo-1.webp'), path.join(tmp, 'studio.webp'));
  fs.writeFileSync(path.join(tmp, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><rect width="300" height="120" rx="20" fill="#111"/><text x="30" y="80" font-size="60" fill="#fff">LOGO</text></svg>');

  async function session(role, viewport = { width: 1440, height: 900 }) {
    const ctx = await browser.newContext({ viewport, acceptDownloads: true, deviceScaleFactor: 1 });
    const log = [];
    await mockDrop(ctx, role, log);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`[${role}] page error: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) problems.push(`[${role}] console: ${m.text()}`); });
    return { ctx, page, log };
  }
  async function login(page, role, password = 'right-password') {
    await page.goto(base);
    await page.fill('input[type=email]', PROFILES[role].email);
    await page.fill('input[type=password]', password);
    await page.click('button:has-text("Sign in")');
  }
  const ed = (page, fn) => page.evaluate(fn);
  const els = (page) => ed(page, () => { const s = window.__dropEditor.getState(); return s.design.pages[s.pageIndex].elements; });

  // ── Access control ──
  if (want('access')) {
    const { page, ctx } = await session('member');
    await login(page, 'member', 'wrong');
    await page.waitForSelector('text=Wrong email or password');
    check('wrong password is refused', true);
    await login(page, 'member');
    await page.waitForSelector('text=doesn’t have access');
    check('members are blocked', true);
    await ctx.close();
  }
  for (const role of want('access') ? ['manager', 'instructor'] : []) {
    const { page, ctx } = await session(role);
    await login(page, role);
    await page.waitForSelector('text=what are we designing');
    check(`${role} can use designs`, true);
    check(`${role} sees no Invoices link`, (await page.locator('nav >> text=Invoices').count()) === 0);
    await page.goto(`${base}/invoices`);
    await page.waitForSelector('text=what are we designing');
    check(`${role} is sent away from /invoices`, !page.url().includes('/invoices'));
    await ctx.close();
  }

  // ── Owner: full editor workflow ──
  const { page, ctx, log } = await session('owner');
  await login(page, 'owner');
  await page.waitForSelector('text=what are we designing');
  check('owner sees Invoices link', (await page.locator('nav >> text=Invoices').count()) === 1);
  await page.screenshot({ path: path.join(OUT, 'desktop-dashboard.png') });
  let e;
  if (want('editor')) {

  await page.click('[data-testid=create-design]');
  await page.click('[data-testid=format-ig-square]');
  await page.waitForSelector('[data-testid=canvas] canvas');
  await page.waitForTimeout(500);
  check('blank Instagram square opens', await ed(page, () => { const d = window.__dropEditor.getState().design; return d.width === 1080 && d.height === 1080; }));

  // Text
  await page.click('button[aria-pressed]:has-text("Text")');
  await page.click('button:has-text("Add a heading")');
  e = await els(page);
  check('heading added', e.length === 1 && e[0].type === 'text');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid=text-editor]');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Summer HIIT');
  await page.keyboard.press('Escape');
  e = await els(page);
  check('text edited in place', e[0].text === 'Summer HIIT', e[0].text);
  // Typing then clicking elsewhere on the canvas must keep the words.
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid=text-editor]');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Summer HIIT Club');
  const cbox = await page.locator('[data-testid=canvas]').boundingBox();
  await page.mouse.click(cbox.x + 8, cbox.y + 8);
  await page.waitForTimeout(200);
  e = await els(page);
  check('typing is kept when clicking away', e[0].text === 'Summer HIIT Club', e[0].text);
  await ed(page, () => { const s = window.__dropEditor.getState(); s.select([s.design.pages[0].elements[0].id]); });
  // Just typing with a text selected starts editing (first letter replaces the words).
  await page.keyboard.type('Heels Night');
  await page.waitForSelector('[data-testid=text-editor]');
  await page.locator('[data-testid=canvas]').click({ position: { x: 6, y: 6 } });
  e = await els(page);
  check('typing on a selected text edits it', e[0].text === 'Heels Night', e[0].text);
  // The Edit text button works too.
  await ed(page, () => { const s = window.__dropEditor.getState(); s.select([s.design.pages[0].elements[0].id]); });
  await page.click('[data-testid=edit-text]');
  await page.waitForSelector('[data-testid=text-editor]');
  await page.keyboard.press('Control+A'); await page.keyboard.type('Summer HIIT Club');
  await page.keyboard.press('Escape');
  check('Edit text button', (await els(page))[0].text === 'Summer HIIT Club');
  // Clicking an already-selected text starts editing.
  {
    const t0 = (await els(page))[0];
    const b0 = await page.locator('[data-testid=canvas]').boundingBox();
    const c0 = await page.evaluate(() => window.__dropCanvas);
    const px = b0.x + c0.pan.x + (t0.x + 30) * c0.zoom, py = b0.y + c0.pan.y + (t0.y + t0.height / 2) * c0.zoom;
    await page.mouse.click(px, py); await page.waitForTimeout(400); await page.mouse.click(px, py);
    await page.waitForSelector('[data-testid=text-editor]', { timeout: 3000 }).catch(() => {});
    check('clicking selected text starts editing', (await page.locator('[data-testid=text-editor]').count()) === 1);
    await page.keyboard.press('Escape');
  }
  await ed(page, () => { const s = window.__dropEditor.getState(); s.select([s.design.pages[0].elements[0].id]); });
  await page.selectOption('select[aria-label=Font]', 'Anton');
  // Clearing the size box and typing a new number must work.
  await page.click('input[aria-label=Size]');
  await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace');
  await page.keyboard.type('120');
  await page.keyboard.press('Enter');
  e = await els(page);
  check('font family and size changed', e[0].fontFamily === 'Anton' && e[0].fontSize === 120);

  // Shapes, drag, resize, rotate
  await page.click('button[aria-pressed]:has-text("Elements")');
  await page.click('button[aria-label="Add Circle"]');
  e = await els(page);
  const circle = e[1];
  const box = await page.locator('[data-testid=canvas]').boundingBox();
  const cv = await page.evaluate(() => window.__dropCanvas);
  const sx = (x) => box.x + cv.pan.x + x * cv.zoom, sy = (y) => box.y + cv.pan.y + y * cv.zoom;
  await page.mouse.move(sx(circle.x + 150), sy(circle.y + 150));
  await page.mouse.down(); await page.mouse.move(sx(circle.x + 250), sy(circle.y + 200), { steps: 8 }); await page.mouse.up();
  e = await els(page);
  check('drag moves the shape', Math.abs(e[1].x - (circle.x + 100)) < 12 && Math.abs(e[1].y - (circle.y + 50)) < 12, `${e[1].x},${e[1].y}`);
  const c2 = e[1];
  await page.mouse.move(sx(c2.x + c2.width), sy(c2.y + c2.height));
  await page.mouse.down(); await page.mouse.move(sx(c2.x + c2.width + 100), sy(c2.y + c2.height + 100), { steps: 8 }); await page.mouse.up();
  e = await els(page);
  check('corner handle resizes', e[1].width > c2.width + 50, `${c2.width}→${e[1].width}`);
  await page.fill('input[aria-label="Rotation°"]', '30');
  e = await els(page);
  check('rotation set', e[1].rotation === 30);

  // Undo / redo
  await page.locator('[data-testid=canvas]').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  e = await els(page);
  check('undo', e[1].rotation === 0, String(e[1].rotation));
  await page.keyboard.press('Control+Shift+z');
  e = await els(page);
  check('redo', e[1].rotation === 30);

  // Duplicate, copy/paste, delete, group/ungroup, lock, layers
  await ed(page, () => { const s = window.__dropEditor.getState(); s.select([s.design.pages[0].elements[1].id]); });
  await page.keyboard.press('Control+d');
  check('duplicate', (await els(page)).length === 3);
  await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
  check('copy and paste', (await els(page)).length === 4);
  await page.keyboard.press('Delete');
  check('delete', (await els(page)).length === 3);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  e = await els(page);
  check('group', e.length === 1 && e[0].type === 'group');
  await page.keyboard.press('Control+Shift+g');
  check('ungroup', (await els(page)).length === 3);
  await ed(page, () => { const s = window.__dropEditor.getState(); s.select([s.design.pages[0].elements[0].id]); });
  await page.click('button[aria-label="Lock"]');
  await page.keyboard.press('Delete');
  check('locked elements can’t be deleted', (await els(page)).length === 3);
  await page.click('button[aria-label="Unlock"]');
  await page.click('button:has-text("Bring to front")').catch(() => page.click('button[aria-label="Bring to front"]'));
  e = await els(page);
  check('bring to front', e[e.length - 1].type === 'text');
  await page.click('button:has-text("Layers")');
  check('layers list shows every element', (await page.locator('ul[aria-label=Layers] li').count()) === 3);
  await page.click('button:has-text("Properties")');

  // Align
  await ed(page, () => { const s = window.__dropEditor.getState(); s.select([s.design.pages[0].elements[0].id]); });
  await page.click('button[aria-label="Align centre"]');
  e = await els(page);
  check('align to page centre', Math.abs(e[0].x + e[0].width / 2 - 540) < 2 || e[0].rotation !== 0);

  // Uploads: JPG/PNG/SVG/WebP
  await page.click('button[aria-pressed]:has-text("Uploads")');
  await page.setInputFiles('[data-testid=upload-input]', [path.join(tmp, 'photo.png'), path.join(tmp, 'studio.webp'), path.join(tmp, 'logo.svg')]);
  await page.waitForSelector('[data-testid=uploads-grid] img >> nth=2');
  // a JPG made in the browser
  const jpg = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#0a8'; g.fillRect(0, 0, 300, 200); return c.toDataURL('image/jpeg', 0.9).split(',')[1]; });
  fs.writeFileSync(path.join(tmp, 'pic.jpg'), Buffer.from(jpg, 'base64'));
  await page.setInputFiles('[data-testid=upload-input]', [path.join(tmp, 'pic.jpg')]);
  await page.waitForSelector('[data-testid=uploads-grid] img >> nth=3');
  check('JPG, PNG, SVG and WebP upload', (await page.locator('[data-testid=uploads-grid] img').count()) === 4);
  await page.locator('[data-testid=uploads-grid] button[title^=photo]').click();
  await page.waitForTimeout(400);
  e = await els(page);
  check('uploaded photo placed on the page', e.some((x) => x.type === 'image' && x.src.startsWith('asset:')));
  await page.fill('input[type=range][aria-label="Rounded corners"]', '40').catch(() => {});

  // Pasting an image copied from another app adds it to the page.
  {
    const before = (await els(page)).length;
    await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 120; c.getContext('2d').fillRect(0, 0, 200, 120);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }));
    });
    await page.waitForTimeout(800);
    check('pasting an image from another app', (await els(page)).length === before + 1);
  }
  // Library image + background + icon
  await page.click('button[aria-pressed]:has-text("Images")');
  await page.locator('button[title^="Drop Studios photo 3"]').first().click();
  await page.click('button[aria-pressed]:has-text("Backgrounds")');
  await page.locator('button[aria-label="Use gradient"]').first().click();
  await page.click('button[aria-pressed]:has-text("Elements")');
  await page.fill('input[aria-label="Search icons"]', 'dumbbell');
  await page.locator('button[aria-label="Add icon Dumbbell"]').click();
  await page.waitForTimeout(500);
  e = await els(page);
  check('library photo and icon added', e.some((x) => x.type === 'image' && x.src.includes('photo-3')) && e.some((x) => x.type === 'icon'));
  check('gradient background set', await ed(page, () => typeof window.__dropEditor.getState().design.pages[0].background.fill === 'object'));

  // Second page
  await page.click('button[aria-label="Add page"]');
  await page.click('button[aria-pressed]:has-text("Text")');
  await page.click('button:has-text("Add body text")');
  check('second page', await ed(page, () => window.__dropEditor.getState().design.pages.length === 2));
  await page.screenshot({ path: path.join(OUT, 'desktop-editor.png') });

  // Save and reopen
  await page.waitForFunction(() => window.__dropEditor.getState().saveStatus === 'saved', null, { timeout: 8000 });
  const id = await ed(page, () => window.__dropEditor.getState().design.id);
  const before = await ed(page, () => JSON.stringify(window.__dropEditor.getState().design.pages));
  await page.waitForTimeout(3000); // thumbnail
  await page.reload();
  await page.waitForSelector('[data-testid=canvas] canvas');
  const after = await ed(page, () => JSON.stringify(window.__dropEditor.getState().design.pages));
  check('project saved and reopened identically', before === after);
  await ed(page, () => window.__dropEditor.getState().setPage(0));
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'desktop-editor-reopened.png') });
  // edit after reopening
  await ed(page, () => { const s = window.__dropEditor.getState(); const t = s.design.pages[0].elements.find((x) => x.type === 'text'); s.updateElement(t.id, { text: 'Edited later' }); });
  await page.waitForFunction(() => window.__dropEditor.getState().saveStatus === 'saved', null, { timeout: 8000 });
  await page.reload(); await page.waitForSelector('[data-testid=canvas] canvas');
  check('saved project can be edited again', await ed(page, () => window.__dropEditor.getState().design.pages[0].elements.some((x) => x.text === 'Edited later')));

  // Exports
  async function exportAs(fmt, opts = {}) {
    await page.click('button:has-text("Download")');
    await page.click(`button[aria-pressed]:has-text("${fmt.toUpperCase()}")`);
    if (opts.quality) await page.selectOption('select[aria-label=Quality]', String(opts.quality));
    if (opts.pages) await page.selectOption('select[aria-label=Pages]', opts.pages);
    if (opts.transparent) await page.check('text=Transparent background');
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await page.click('[data-testid=export-go]');
    await page.waitForSelector('[data-testid=export-go]', { state: 'detached', timeout: 30000 });
    await page.waitForTimeout(800);
    page.removeAllListeners('download');
    return Promise.all(downloads.map(async (d) => { const p = path.join(OUT, d.suggestedFilename()); await d.saveAs(p); return p; }));
  }
  let files = await exportAs('png', { quality: 2, pages: 'current' });
  let png = fs.readFileSync(files[0]);
  check('PNG export at high quality (2160×2160)', pngSize(png).w === 2160 && pngSize(png).h === 2160, JSON.stringify(pngSize(png)));
  files = await exportAs('png', { quality: 1, pages: 'all', transparent: true });
  check('PNG export of all pages', files.length === 2, files.join(','));
  png = fs.readFileSync(files[0]);
  check('transparent PNG has an alpha channel', png[25] === 6, String(png[25]));
  files = await exportAs('jpg', { quality: 1, pages: 'current' });
  const jb = fs.readFileSync(files[0]);
  check('JPG export', jb[0] === 0xff && jb[1] === 0xd8 && jb.length > 20000, String(jb.length));
  files = await exportAs('pdf', { quality: 2, pages: 'all' });
  const pdf = fs.readFileSync(files[0]).toString('latin1');
  check('PDF export with 2 pages', pdf.startsWith('%PDF') && (pdf.match(/\/Type \/Page\b/g) || []).length === 2);

  }
  // Templates
  if (want('templates')) {
  await page.goto(base);
  await page.waitForSelector('[data-testid=template-hip-hop-poster] img', { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'desktop-templates.png'), fullPage: true });
  await page.click('[data-testid=template-hip-hop-poster]');
  await page.waitForSelector('[data-testid=canvas] canvas');
  await page.waitForTimeout(1200);
  e = await els(page);
  check('template opens with editable elements', e.length > 8 && e.some((x) => x.type === 'text' && x.text === 'HIP HOP'));
  await page.screenshot({ path: path.join(OUT, 'desktop-template-editor.png') });
  check('dashboard lists saved designs', true);

  }
  // Brand kit
  if (want('templates')) {
  await page.goto(`${base}/brand`);
  await page.waitForSelector('text=Brand Kit');
  await page.setInputFiles('input[type=file]', [path.join(tmp, 'logo.svg')]);
  await page.waitForSelector('text=Logo added');
  check('brand logo uploaded', true);

  }
  // Drop event artwork
  if (want('drop')) {
  await page.goto(`${base}/drop`);
  await page.waitForSelector('[data-testid=drop-event]');
  await page.click('button:has-text("Create artwork")');
  await page.setInputFiles('[data-testid=brief-photos]', [path.join(tmp, 'studio.webp')]);
  await page.waitForTimeout(500);
  await page.click('[data-testid=generate]');
  await page.waitForSelector('[data-testid=design-option] img >> nth=3', { timeout: 30000 });
  await page.screenshot({ path: path.join(OUT, 'desktop-drop-options.png') });
  check('four design options generated', (await page.locator('[data-testid=design-option]').count()) === 4);
  await page.locator('[data-testid=design-option]').first().click();
  await page.waitForSelector('[data-testid=canvas] canvas');
  await page.click('button:has-text("Send to Drop")');
  await page.waitForSelector('img[alt="What will be published"]');
  await page.screenshot({ path: path.join(OUT, 'desktop-send-to-drop.png') });
  await page.click('[data-testid=approve-publish]');
  await page.waitForSelector('text=Live in the Drop app');
  check('artwork uploaded and attached to the Drop event', log.some((l) => l.startsWith('POST /storage/v1/object/event-art/11111111')) && log.includes('POST /rest/v1/rpc/set_event_artwork'));
  await page.click('button:has-text("Done")');

  }
  // Invoices
  if (want('invoices')) {
  await page.goto(`${base}/invoices`);
  await page.click('[data-testid=new-invoice]');
  await page.fill('[data-testid=client-name]', 'Acme Wellness Ltd');
  await page.fill('[data-testid=client-email]', 'accounts@acme.example');
  await page.click('[data-testid=next]');
  await page.fill('[data-testid=item-desc-0]', 'Corporate dance workshop');
  await page.fill('[data-testid=item-price-0]', '123');
  await page.click('[data-testid=next]');
  await page.click('[data-testid=vat-included]');
  await page.click('[data-testid=next]');
  await page.fill('[data-testid=bank-name]', 'Drop Studios Limited');
  await page.fill('[data-testid=bank-iban]', 'IE29 AIBK 9311 5212 3456 78');
  await page.click('[data-testid=next]');
  await page.waitForSelector('[data-testid=invoice-preview]');
  check('invoice preview total (VAT included)', (await page.textContent('[data-testid=invoice-total]')).includes('123.00'));
  check('VAT shown in preview', (await page.textContent('[data-testid=invoice-preview]')).includes('VAT @ 23%'));
  await page.screenshot({ path: path.join(OUT, 'desktop-invoice-preview.png') });
  await page.click('[data-testid=approve-invoice]');
  await page.waitForSelector('[data-testid=download-pdf]');
  check('invoice approved with a number', (await page.textContent('h1')).includes('DS-'));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid=download-pdf]')]);
  const ip = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(ip);
  check('invoice PDF', fs.readFileSync(ip).toString('latin1').startsWith('%PDF'));
  await page.click('[data-testid=mark-paid]');
  await page.waitForSelector('h1 >> text=Paid');
  await page.goto(`${base}/invoices`);
  await page.waitForSelector('[data-testid=invoice-row]');
  check('invoice list and analysis', (await page.textContent('main')).includes('Paid') && (await page.textContent('main')).includes('€123.00'));
  await page.screenshot({ path: path.join(OUT, 'desktop-invoices.png') });
  }
  await ctx.close();

  // Tablet sizes
  for (const [name, vp] of !want('tablet') ? [] : [['tablet-landscape', { width: 1024, height: 768 }], ['tablet-portrait', { width: 820, height: 1180 }]]) {
    const s = await session('owner', vp);
    await login(s.page, 'owner');
    await s.page.waitForSelector('text=what are we designing');
    const over = await s.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`${name}: dashboard has no sideways scroll`, over <= 0, String(over));
    await s.page.click('[data-testid=create-design]');
    await s.page.click('[data-testid=format-ig-portrait]');
    await s.page.waitForSelector('[data-testid=canvas] canvas');
    await s.page.waitForTimeout(600);
    const cb = await s.page.locator('[data-testid=canvas]').boundingBox();
    check(`${name}: canvas has room`, cb.width > 300 && cb.height > 300, `${cb.width}x${cb.height}`);
    await s.page.screenshot({ path: path.join(OUT, `${name}-editor.png`) });
    await s.ctx.close();
  }

  await browser.close();
  server.close();
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(results.map((r) => `${r[0]}  ${r[1]}${r[2] && r[0] === 'FAIL' ? ` (${r[2]})` : ''}`).join('\n'));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log(problems.length ? `Console/page errors:\n${[...new Set(problems)].join('\n')}` : 'No console or page errors.');
  process.exit(failed.length || problems.length ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
