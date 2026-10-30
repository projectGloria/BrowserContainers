// Extension-wide preferences, stored in chrome.storage.local next to `containers` so the SW
// and every UI context get change events for free.
export interface Settings {
  // Show container tabs as Chromium tab groups. Off = the per-tab toolbar icon is the only
  // marker. Grouping is purely cosmetic either way: isolation is the cookie jar, not the group.
  groupTabs: boolean;
}

const KEY = 'settings';
const DEFAULTS: Settings = { groupTabs: true };

// Merge over defaults so settings added in later versions get a value without a migration.
const parse = (raw: unknown): Settings => ({ ...DEFAULTS, ...(raw as Partial<Settings> | undefined) });

export async function getSettings(): Promise<Settings> {
  return parse((await chrome.storage.local.get(KEY))[KEY]);
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set({ [KEY]: { ...(await getSettings()), ...patch } });
}

export const settingsChange = (changes: Record<string, chrome.storage.StorageChange>) =>
  KEY in changes ? { before: parse(changes[KEY]!.oldValue), after: parse(changes[KEY]!.newValue) } : undefined;

// --- external store plumbing (UI contexts only), same shape as containersStore ---

let snapshot: Settings = DEFAULTS;
const listeners = new Set<() => void>();
let wired = false;
let loaded = false;

function emit(next: Settings) {
  loaded = true;
  snapshot = next; // new object only on a real change -> stable getSnapshot between changes
  listeners.forEach((l) => l());
}

export function subscribeSettings(listener: () => void): () => void {
  if (!wired) {
    wired = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      const ch = area === 'local' ? settingsChange(changes) : undefined;
      if (ch) emit(ch.after);
    });
    // Don't clobber a newer onChanged value that raced ahead of the initial read.
    void getSettings().then((s) => {
      if (!loaded) emit(s);
    });
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getSettingsSnapshot = (): Settings => snapshot;
