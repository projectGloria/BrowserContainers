import { use } from 'react';
import { send } from '../shared/messages';
import { ContainerIcon } from '../ui/ContainerIcon';
import { useContainers, useContainersLoaded } from '../ui/hooks';
import { GlobeIcon, LeaveIcon, MoveInIcon, PlusIcon, SettingsIcon } from '../ui/icons';
import { Bookmarks } from './Bookmarks';

// Created once at module load, not inside the component: `use()` needs a stable promise,
// and a promise created during render would be a new one every render -> infinite suspend.
// The popup document is torn down on close, so "once per open" is exactly right.
const currentTabPromise = (async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return { tab: undefined, containerId: null };
  const { containerId } = await send({ type: 'tab/getContainer', tabId: tab.id });
  return { tab, containerId };
})();

const isWeb = (url?: string) => !!url && /^https?:/i.test(url);

export function Popup() {
  const { tab, containerId } = use(currentTabPromise);
  const containers = useContainers();
  const loaded = useContainersLoaded();
  const current = containers.find((c) => c.id === containerId);
  const canReopen = tab?.id !== undefined && isWeb(tab.url);

  // Opening a tab moves focus, which closes the popup anyway; close explicitly so it
  // doesn't linger when the new tab opens in the background.
  const run = (p: Promise<unknown>) => void p.finally(() => window.close());
  const manage = () => void chrome.runtime.openOptionsPage();

  return (
    <div className="pp">
      <header className="pp-head">
        {current ? (
          <ContainerIcon container={current} size={28} />
        ) : (
          <span className="pp-head__none">
            <GlobeIcon size={16} />
          </span>
        )}
        <div className="pp-head__text">
          <span className="pp-head__kicker">Current tab</span>
          <span className="pp-head__name">{current ? current.name : 'No container'}</span>
        </div>
        {current && canReopen && (
          <button
            className="icon-btn"
            title="Reopen this page outside the container"
            aria-label="Leave container"
            onClick={() => run(send({ type: 'tab/reopenIn', tabId: tab.id!, containerId: null }))}
          >
            <LeaveIcon />
          </button>
        )}
      </header>

      {loaded && containers.length === 0 ? (
        <div className="pp-empty">
          <p>Create a container to open sites with their own cookies.</p>
          <button className="btn btn--primary" onClick={manage}>
            <PlusIcon size={14} /> New container
          </button>
        </div>
      ) : (
        <section className="pp-section">
          <h2 className="pp-label">Containers</h2>
          <ul className="ct-list">
            {containers.map((c) => (
              <li key={c.id} className="ct">
                <button
                  className="ct__open"
                  title={`Open a new tab in ${c.name}`}
                  onClick={() => run(send({ type: 'tab/open', containerId: c.id }))}
                >
                  <ContainerIcon container={c} size={22} />
                  <span className="ellipsis">{c.name}</span>
                  {c.id === containerId && <span className="ct__badge">This tab</span>}
                  <span className="ct__hint">
                    <PlusIcon size={14} /> New tab
                  </span>
                </button>
                {canReopen && c.id !== containerId && (
                  <button
                    className="icon-btn ct__move"
                    title={`Move this page into ${c.name}`}
                    aria-label={`Move this page into ${c.name}`}
                    onClick={() => run(send({ type: 'tab/reopenIn', tabId: tab.id!, containerId: c.id }))}
                  >
                    <MoveInIcon />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {containers.length > 0 && <Bookmarks containers={containers} />}

      <footer className="pp-foot">
        <button className="btn btn--ghost" onClick={manage}>
          <SettingsIcon size={14} /> Manage containers
        </button>
      </footer>
    </div>
  );
}
