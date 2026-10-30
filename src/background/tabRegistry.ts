import { SessionMap } from './sessionMap';

// tabId -> containerId. Tabs absent from the map are "default" tabs using the real cookie store.
const bindings = new SessionMap<number, string>('tabBindings', Number);

export const getContainerOf = (tabId: number) => bindings.get(tabId);

export const bindTab = (tabId: number, containerId: string) => bindings.set(tabId, containerId);

export async function unbindTab(tabId: number): Promise<string | undefined> {
  const prev = await bindings.get(tabId);
  await bindings.delete(tabId);
  return prev;
}

export async function tabsOf(containerId: string): Promise<number[]> {
  return (await bindings.entries()).filter(([, c]) => c === containerId).map(([t]) => t);
}

export async function boundContainerIds(): Promise<Set<string>> {
  return new Set((await bindings.entries()).map(([, c]) => c));
}
