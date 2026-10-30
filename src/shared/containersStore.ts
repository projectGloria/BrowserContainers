import type { Container, ContainerColor } from './types';

const KEY = 'containers';

// Snapshot cache for useSyncExternalStore: getSnapshot MUST return a referentially stable
// value between changes, otherwise React sees a "new" store value every render and loops.
// We only replace this array when chrome.storage reports a real change.
let snapshot: readonly Container[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function emit(next: readonly Container[]) {
  snapshot = next;
  loaded = true;
  listeners.forEach((l) => l());
}

export async function listContainers(): Promise<Container[]> {
  const res = await chrome.storage.local.get(KEY);
  return (res[KEY] as Container[] | undefined) ?? [];
}

async function write(next: Container[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: next });
}

// `id`/`iconVersion` can be pre-chosen so the icon blob is written to IDB *before* the
// container appears in storage: listeners never observe a container whose icon is missing.
export async function createContainer(
  name: string,
  color: ContainerColor,
  init: { id?: string; iconVersion?: number } = {},
): Promise<Container> {
  const c: Container = {
    id: init.id ?? crypto.randomUUID(),
    name: name.trim(),
    color,
    createdAt: Date.now(),
    iconVersion: init.iconVersion ?? 0,
  };
  await write([...(await listContainers()), c]);
  return c;
}

export async function updateContainer(
  id: string,
  patch: Partial<Pick<Container, 'name' | 'color' | 'iconVersion'>>,
): Promise<void> {
  const all = await listContainers();
  await write(all.map((c) => (c.id === id ? { ...c, ...patch } : c)));
}

export async function removeContainer(id: string): Promise<void> {
  await write((await listContainers()).filter((c) => c.id !== id));
}

// --- external store plumbing (UI contexts only) ---

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  // One storage listener per JS context, fanned out to N React subscribers.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) {
      emit((changes[KEY]?.newValue as Container[] | undefined) ?? []);
    }
  });
  void listContainers().then((c) => {
    // Don't clobber a newer onChanged value that raced ahead of the initial read.
    if (!loaded) emit(c);
  });
}

export function subscribe(listener: () => void): () => void {
  wire();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getSnapshot = (): readonly Container[] => snapshot;
export const isLoaded = (): boolean => loaded;
