// A Map mirrored into chrome.storage.session.
// Why: the MV3 service worker is killed after ~30s idle and all module state is lost, but
// storage.session survives SW restarts (and is wiped on browser restart, exactly like tab IDs
// and DNR session rules are). So it's the right lifetime for tab/rule bookkeeping.
export class SessionMap<K extends string | number, V> {
  private cache: Promise<Map<K, V>> | undefined;

  constructor(
    private readonly key: string,
    private readonly parseKey: (k: string) => K,
  ) {}

  private load(): Promise<Map<K, V>> {
    // Memoize the *promise*, not the result: concurrent callers during cold start must
    // share one read, or the second caller's write could be clobbered by the first's stale map.
    this.cache ??= chrome.storage.session.get(this.key).then((r) => {
      const raw = (r[this.key] ?? {}) as Record<string, V>;
      return new Map(Object.entries(raw).map(([k, v]) => [this.parseKey(k), v] as [K, V]));
    });
    return this.cache;
  }

  private async flush(m: Map<K, V>) {
    await chrome.storage.session.set({ [this.key]: Object.fromEntries(m) });
  }

  async get(k: K): Promise<V | undefined> {
    return (await this.load()).get(k);
  }

  async entries(): Promise<[K, V][]> {
    return [...(await this.load()).entries()];
  }

  async set(k: K, v: V): Promise<void> {
    const m = await this.load();
    m.set(k, v);
    await this.flush(m);
  }

  async delete(k: K): Promise<boolean> {
    const m = await this.load();
    const had = m.delete(k);
    if (had) await this.flush(m);
    return had;
  }
}
