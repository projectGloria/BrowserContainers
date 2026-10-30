import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SerializedCookieJar } from 'tough-cookie';
import type { IconSet } from './types';

// IndexedDB is origin-scoped, so the SW, popup and options page (all chrome-extension://<id>)
// share this database. Binary blobs live here instead of chrome.storage.local because
// storage.local is JSON-only and would force a ~33% base64 tax on every icon.
interface GloriaDB extends DBSchema {
  icons: { key: string; value: IconSet };
  jars: { key: string; value: { containerId: string; jar: SerializedCookieJar } };
}

let dbPromise: Promise<IDBPDatabase<GloriaDB>> | undefined;

// Memoize the open handle: in the SW, top-level state dies on termination, so this lazily
// re-opens after every wake instead of assuming a long-lived connection.
export function db(): Promise<IDBPDatabase<GloriaDB>> {
  dbPromise ??= openDB<GloriaDB>('gloria-containers', 1, {
    upgrade(d) {
      d.createObjectStore('icons', { keyPath: 'containerId' });
      d.createObjectStore('jars', { keyPath: 'containerId' });
    },
  });
  return dbPromise;
}

export async function getIcon(containerId: string): Promise<IconSet | undefined> {
  return (await db()).get('icons', containerId);
}

export async function putIcon(icon: IconSet): Promise<void> {
  await (await db()).put('icons', icon);
}

export async function deleteIcon(containerId: string): Promise<void> {
  await (await db()).delete('icons', containerId);
}

export async function getJar(containerId: string): Promise<SerializedCookieJar | undefined> {
  return (await db()).get('jars', containerId).then((r) => r?.jar);
}

export async function putJar(containerId: string, jar: SerializedCookieJar): Promise<void> {
  await (await db()).put('jars', { containerId, jar });
}

export async function deleteJar(containerId: string): Promise<void> {
  await (await db()).delete('jars', containerId);
}
