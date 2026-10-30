import { use, useDeferredValue, useMemo, useState } from 'react';
import { send } from '../shared/messages';
import type { Container } from '../shared/types';
import { ContainerIcon } from '../ui/ContainerIcon';
import { SearchIcon } from '../ui/icons';

interface Bookmark {
  id: string;
  title: string;
  url: string;
  host: string;
  // Folder path below the top-level roots ("Bookmarks bar", "Other bookmarks"), which carry
  // no information for the user. Empty for bookmarks sitting directly in a root.
  folder: string;
  // Lowercased title + url + folder, precomputed once so filtering per keystroke is a plain
  // substring scan with no allocations.
  hay: string;
}

const isWeb = (url?: string) => !!url && /^https?:/i.test(url);
const RENDER_LIMIT = 150;
// Up to this many containers get a one-click button on each row; more collapse into "+N".
const INLINE_CONTAINERS = 4;

// Depth-first, so the list keeps the user's own order: bar first, then Other, then Mobile.
function flatten(roots: chrome.bookmarks.BookmarkTreeNode[]): Bookmark[] {
  const out: Bookmark[] = [];
  const walk = (n: chrome.bookmarks.BookmarkTreeNode, path: string[]) => {
    if (n.url) {
      // javascript:/chrome:// bookmarks can't be loaded inside a container.
      if (!isWeb(n.url)) return;
      const host = new URL(n.url).hostname.replace(/^www\./, '');
      const folder = path.join(' / ');
      const title = n.title || host;
      out.push({ id: n.id, title, url: n.url, host, folder, hay: `${title}\n${n.url}\n${folder}`.toLowerCase() });
      return;
    }
    for (const c of n.children ?? []) walk(c, [...path, n.title]);
  };
  // Start below the invisible root and the Bookmarks bar / Other / Mobile roots, so those
  // never show up in a path.
  for (const r of roots) for (const top of r.children ?? []) for (const c of top.children ?? []) walk(c, []);
  return out;
}

// Read once per popup open (the popup document is destroyed on close), at module load so
// `use()` gets a stable promise instead of a new one per render.
const bookmarksPromise = chrome.bookmarks.getTree().then(flatten, () => [] as Bookmark[]);

// MV3 `favicon` permission: the browser's own favicon cache, so listing bookmarks never
// contacts the sites.
const faviconUrl = (pageUrl: string) =>
  chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`);

export function Bookmarks({ containers }: { containers: readonly Container[] }) {
  const all = use(bookmarksPromise);
  const [query, setQuery] = useState('');
  // The input updates at once and the list filters at low priority, so typing stays smooth
  // even with thousands of bookmarks.
  const deferred = useDeferredValue(query);
  // Row whose full container list is expanded (only used when there are > INLINE_CONTAINERS).
  const [expandedId, setExpandedId] = useState<string>();

  const matches = useMemo(() => {
    const q = deferred.trim().toLowerCase();
    return q ? all.filter((b) => b.hay.includes(q)) : all;
  }, [all, deferred]);
  const shown = matches.slice(0, RENDER_LIMIT);

  const inline = containers.slice(0, INLINE_CONTAINERS);
  const overflow = containers.length - inline.length;

  const open = (url: string, containerId: string) =>
    void send({ type: 'tab/open', containerId, url }).finally(() => window.close());

  if (all.length === 0) return null;

  return (
    <section className="pp-section pp-section--bm">
      <div className="pp-section__head">
        <h2 className="pp-label">Bookmarks</h2>
        <span className="pp-count">{matches.length}</span>
      </div>

      <label className="pp-search">
        <SearchIcon size={14} />
        <input
          type="search"
          placeholder="Search bookmarks"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          // Enter opens the top hit in the first container: search → Enter is the fast path.
          onKeyDown={(e) => {
            if (e.key === 'Enter' && shown[0] && containers[0]) open(shown[0].url, containers[0].id);
          }}
          autoFocus
        />
      </label>

      <ul className="bm-list" aria-busy={deferred !== query}>
        {shown.length === 0 && <li className="bm-empty">No bookmarks match “{deferred}”.</li>}
        {shown.map((b) => (
          <li key={b.id} className="bm">
            <div className="bm__row">
              <img className="bm__fav" src={faviconUrl(b.url)} width={16} height={16} alt="" />
              <div className="bm__text" title={b.url}>
                <span className="bm__title">{b.title}</span>
                <span className="bm__sub">
                  {b.host}
                  {b.folder && <span className="bm__folder"> · {b.folder}</span>}
                </span>
              </div>
              <div className="bm__actions">
                {inline.map((c) => (
                  <button
                    key={c.id}
                    className="bm__open"
                    title={`Open in ${c.name}`}
                    aria-label={`Open ${b.title} in ${c.name}`}
                    onClick={() => open(b.url, c.id)}
                  >
                    <ContainerIcon container={c} size={18} />
                  </button>
                ))}
                {overflow > 0 && (
                  <button
                    className="bm__more"
                    aria-expanded={expandedId === b.id}
                    title="More containers"
                    onClick={() => setExpandedId((cur) => (cur === b.id ? undefined : b.id))}
                  >
                    +{overflow}
                  </button>
                )}
              </div>
            </div>
            {expandedId === b.id && (
              <div className="bm__pick" role="group" aria-label="Open in container">
                {containers.map((c) => (
                  <button key={c.id} className="chip" onClick={() => open(b.url, c.id)}>
                    <ContainerIcon container={c} size={16} />
                    <span className="ellipsis">{c.name}</span>
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
        {matches.length > shown.length && (
          <li className="bm-empty">
            Showing {shown.length} of {matches.length}. Type to narrow down.
          </li>
        )}
      </ul>
    </section>
  );
}
