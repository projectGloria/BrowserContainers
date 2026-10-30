import { useState } from 'react';
import { send } from '../shared/messages';
import { updateSettings } from '../shared/settings';
import type { Container } from '../shared/types';
import { useContainers, useContainersLoaded, useSettings } from '../ui/hooks';
import { ContainerForm } from './ContainerForm';
import { QuickIcon } from './QuickIcon';

function ContainerItem({ c }: { c: Container }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="card">
        <ContainerForm initial={c} onDone={() => setEditing(false)} />
      </div>
    );
  }

  const del = async () => {
    const { count } = await send({ type: 'container/tabCount', containerId: c.id });
    const tabs = count ? ` Its ${count} open tab${count > 1 ? 's' : ''} will be closed.` : '';
    if (!confirm(`Delete "${c.name}" and all its cookies?${tabs}`)) return;
    await send({ type: 'container/delete', containerId: c.id });
  };

  const clear = async () => {
    if (!confirm(`Sign out of everything in "${c.name}"? This deletes all its cookies.`)) return;
    await send({ type: 'container/clearCookies', containerId: c.id });
  };

  return (
    <div className="item">
      <QuickIcon c={c} />
      <span className="item__name">{c.name}</span>
      <div className="item__actions">
        <button className="btn" onClick={() => void send({ type: 'tab/open', containerId: c.id })}>
          New tab
        </button>
        <button className="btn" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button className="btn" onClick={() => void clear()}>
          Clear cookies
        </button>
        <button className="btn btn--danger" onClick={() => void del()}>
          Delete
        </button>
      </div>
    </div>
  );
}

export function Options() {
  const containers = useContainers();
  const loaded = useContainersLoaded();
  const settings = useSettings();

  return (
    <main className="options">
      <h1>Gloria Containers</h1>
      <p className="muted">
        Each container has its own cookie jar, so you can stay signed in to the same site with
        different accounts side by side.
      </p>

      <h2>Settings</h2>
      <div className="card">
        {/* Controlled straight off storage: no local mirror, the onChanged round-trip re-renders it. */}
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.groupTabs}
            onChange={(e) => void updateSettings({ groupTabs: e.currentTarget.checked })}
          />
          <span>
            Show container tabs as tab groups
            <span className="muted toggle__hint">
              Only a visual label. Chromium saves tab groups, so closing a group&apos;s last tab asks
              to &ldquo;delete group&rdquo;. That deletes the saved group, not the container or its cookies.
              Turn this off to use only the toolbar icon as the container marker.
            </span>
          </span>
        </label>
      </div>

      <h2>New container</h2>
      <div className="card">
        <ContainerForm />
      </div>

      <h2>Containers</h2>
      {loaded && containers.length === 0 && <p className="muted">No containers yet.</p>}
      <div className="list">
        {containers.map((c) => (
          <ContainerItem key={c.id} c={c} />
        ))}
      </div>
    </main>
  );
}
