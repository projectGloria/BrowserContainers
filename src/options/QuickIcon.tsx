import { useState, useTransition } from 'react';
import { saveContainerIcon } from '../shared/icons/saveIcon';
import { IconError, processImage } from '../shared/icons/processImage';
import type { Container } from '../shared/types';
import { ContainerIcon } from '../ui/ContainerIcon';

// Click (or drop on) a container's icon in the list to replace it, saved immediately.
// Before this, the only path was Edit → pick → Save, and an image picked in the
// "New container" form looked applied while being unsaved draft state.
export function QuickIcon({ c }: { c: Container }) {
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [saving, startTransition] = useTransition();

  const handle = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      try {
        const sizes = await processImage(file);
        // Blob first, metadata second, same as ContainerForm: the iconVersion bump is the
        // commit every context (popup, SW toolbar icon) reacts to, so the blob must exist by then.
        await saveContainerIcon(c.id, { sizes, sourceName: file.name });
      } catch (e) {
        // Updates after an await are outside the transition's scope in React 19: re-wrap.
        startTransition(() => setError(e instanceof IconError ? e.message : 'Could not use that image.'));
      }
    });
  };

  return (
    <div className="qicon-wrap">
      <label
        className={`qicon${over ? ' qicon--over' : ''}${saving ? ' qicon--busy' : ''}`}
        title={c.iconVersion ? 'Change icon' : 'Set an icon'}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handle(e.dataTransfer.files[0]);
        }}
      >
        <ContainerIcon container={c} size={36} />
        <span className="qicon__badge" aria-hidden>
          {saving ? '…' : '✎'}
        </span>
        <input
          type="file"
          accept="image/*"
          aria-label={`Set icon for ${c.name}`}
          disabled={saving}
          onChange={(e) => {
            handle(e.target.files?.[0]);
            e.target.value = ''; // allow re-picking the same file
          }}
        />
      </label>
      {error && <p className="error qicon__error">{error}</p>}
    </div>
  );
}
