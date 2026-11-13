// Local persistence (IndexedDB). Every store is behind a small repository interface so a
// cloud backend (accounts + server storage) can replace it later without touching the UI.
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Asset, BrandKit, Design, Folder } from '../model/types';
import type { BankAccount, Client, Invoice, BusinessProfile } from '../invoices/types';

interface DropDesignDB extends DBSchema {
  projects: { key: string; value: Design; indexes: { updatedAt: number } };
  folders: { key: string; value: Folder };
  assets: { key: string; value: Asset; indexes: { createdAt: number } };
  brand: { key: string; value: BrandKit };
  invoices: { key: string; value: Invoice; indexes: { issueDate: string } };
  clients: { key: string; value: Client };
  bankAccounts: { key: string; value: BankAccount };
  settings: { key: string; value: { key: string; value: unknown } };
  business: { key: string; value: BusinessProfile };
}

let dbp: Promise<IDBPDatabase<DropDesignDB>> | null = null;
export function db() {
  dbp ??= openDB<DropDesignDB>('drop-design', 1, {
    upgrade(d) {
      d.createObjectStore('projects', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      d.createObjectStore('folders', { keyPath: 'id' });
      d.createObjectStore('assets', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      d.createObjectStore('brand', { keyPath: 'id' });
      d.createObjectStore('invoices', { keyPath: 'id' }).createIndex('issueDate', 'issueDate');
      d.createObjectStore('clients', { keyPath: 'id' });
      d.createObjectStore('bankAccounts', { keyPath: 'id' });
      d.createObjectStore('settings', { keyPath: 'key' });
      d.createObjectStore('business', { keyPath: 'id' });
    },
  });
  return dbp;
}

/** Ask the browser not to clear our data under storage pressure (best effort). */
export async function requestPersistence(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}

export const projects = {
  list: async () => (await (await db()).getAll('projects')).sort((a, b) => b.updatedAt - a.updatedAt),
  get: async (id: string) => (await db()).get('projects', id),
  save: async (d: Design) => { await (await db()).put('projects', d); },
  remove: async (id: string) => { await (await db()).delete('projects', id); },
};

export const folders = {
  list: async () => (await (await db()).getAll('folders')).sort((a, b) => a.name.localeCompare(b.name)),
  save: async (f: Folder) => { await (await db()).put('folders', f); },
  remove: async (id: string) => {
    const d = await db();
    const tx = d.transaction(['folders', 'projects'], 'readwrite');
    await tx.objectStore('folders').delete(id);
    for (const p of await tx.objectStore('projects').getAll()) {
      if (p.folderId === id) await tx.objectStore('projects').put({ ...p, folderId: null });
    }
    await tx.done;
  },
};

export const assets = {
  list: async () => (await (await db()).getAll('assets')).sort((a, b) => b.createdAt - a.createdAt),
  get: async (id: string) => (await db()).get('assets', id),
  save: async (a: Asset) => { await (await db()).put('assets', a); },
  remove: async (id: string) => { await (await db()).delete('assets', id); },
};

export const brandStore = {
  get: async () => (await db()).get('brand', 'brand'),
  save: async (b: BrandKit) => { await (await db()).put('brand', b); },
};

export const settings = {
  get: async <T>(key: string, fallback: T): Promise<T> => ((await (await db()).get('settings', key))?.value as T) ?? fallback,
  set: async (key: string, value: unknown) => { await (await db()).put('settings', { key, value }); },
};
