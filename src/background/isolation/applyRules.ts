import { SessionMap } from '../sessionMap';
import { tabsOf } from '../tabRegistry';
import { compileRules } from './compileRules';
import { jarFor } from './cookieJar';

// Each container owns a fixed block of rule IDs: [slot*1000+1, slot*1000+999].
// Lets us find "this container's rules" by range instead of persisting ID lists,
// and makes updates a single atomic updateSessionRules(remove range, add new).
const SLOT_SIZE = 1000;
const slots = new SessionMap<string, number>('ruleSlots', String);

async function slotFor(containerId: string): Promise<number> {
  const existing = await slots.get(containerId);
  if (existing !== undefined) return existing;
  const used = new Set((await slots.entries()).map(([, s]) => s));
  let slot = 1;
  while (used.has(slot)) slot++;
  await slots.set(containerId, slot);
  return slot;
}

async function doApply(containerId: string): Promise<void> {
  const tabIds = await tabsOf(containerId);
  const slot = await slotFor(containerId);
  const base = slot * SLOT_SIZE;
  const removeRuleIds = (await chrome.declarativeNetRequest.getSessionRules())
    .map((r) => r.id)
    .filter((id) => id > base && id < base + SLOT_SIZE);

  const { rules, truncated } = compileRules(await jarFor(containerId), tabIds, base, SLOT_SIZE - 1);
  if (truncated) console.warn(`[gloria] ${containerId}: rule cap hit, least-specific cookies dropped`);

  // The cast lives here, once: compileRules emits literal-typed rules (see DnrRule).
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds,
    addRules: rules as unknown as chrome.declarativeNetRequest.Rule[],
  });
  if (tabIds.length === 0) await slots.delete(containerId);
}

// Per-container serial queue with coalescing.
// - Serial: two overlapping applies could interleave getSessionRules/updateSessionRules and
//   try to add duplicate IDs (DNR rejects the whole batch).
// - Coalescing: a burst of 20 Set-Cookie headers queues ONE extra apply, not 20, and every
//   caller awaiting it is guaranteed to see a compile that includes their change.
const tail = new Map<string, Promise<void>>();
const pending = new Map<string, Promise<void>>();

export function applyRules(containerId: string): Promise<void> {
  const queued = pending.get(containerId);
  if (queued) return queued;
  const run = (tail.get(containerId) ?? Promise.resolve())
    .then(() => {
      pending.delete(containerId); // from here on, new changes need a fresh run
      return doApply(containerId);
    })
    .catch((e) => console.error('[gloria] applyRules failed', containerId, e));
  pending.set(containerId, run);
  tail.set(containerId, run);
  return run;
}
