import { db } from './db';

const STORES = ['projects', 'folders', 'assets', 'brand', 'invoices', 'clients', 'bankAccounts', 'settings', 'business'] as const;
const FINANCE = ['invoices', 'clients', 'bankAccounts', 'business'];

const toDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

/** Everything in this browser as one file (uploads embedded). Invoices only for people allowed to see them. */
export async function exportBackup(includeFinance: boolean): Promise<Blob> {
  const d = await db();
  const out: Record<string, unknown[]> = {};
  for (const s of STORES) {
    if (!includeFinance && FINANCE.includes(s)) continue;
    const rows = await d.getAll(s);
    out[s] = s === 'assets' ? await Promise.all((rows as { blob: Blob }[]).map(async (a) => ({ ...a, blob: await toDataUrl(a.blob) }))) : rows;
  }
  return new Blob([JSON.stringify({ app: 'drop-design-backup', version: 1, createdAt: Date.now(), data: out })], { type: 'application/json' });
}

export async function importBackup(file: File, includeFinance: boolean): Promise<number> {
  let parsed: { app?: string; data?: Record<string, unknown[]> };
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error('That isn’t a Drop Design backup file.'); }
  if (parsed.app !== 'drop-design-backup' || !parsed.data) throw new Error('That isn’t a Drop Design backup file.');
  const d = await db();
  let n = 0;
  for (const s of STORES) {
    if (!includeFinance && FINANCE.includes(s)) continue;
    for (const row of parsed.data[s] ?? []) {
      const r = row as Record<string, unknown>;
      if (s === 'assets' && typeof r.blob === 'string') r.blob = await (await fetch(r.blob)).blob();
      await d.put(s, r as never);
      n++;
    }
  }
  return n;
}
