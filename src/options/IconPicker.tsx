import { useState, useTransition, type DragEvent } from 'react';
import { IconError, processImage } from '../shared/icons/processImage';
import type { Container, IconSize } from '../shared/types';
import { ContainerIcon } from '../ui/ContainerIcon';

export interface PickedIcon {
  sizes: Record<IconSize, Blob>;
  sourceName: string;
}

interface Props {
  container: Pick<Container, 'id' | 'name' | 'color' | 'iconVersion'>;
  picked: PickedIcon | null;
  onPick: (icon: PickedIcon) => void | Promise<void>;
}

export function IconPicker({ container, picked, onPick }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [processing, startTransition] = useTransition();

  const handle = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    // Async transition (React 19): `processing` stays true across the await, no manual flag.
    startTransition(async () => {
      try {
        const sizes = await processImage(file);
        // State updates after an `await` fall outside the transition's scope in React 19,
        // so they must be re-wrapped to stay non-blocking.
        await onPick({ sizes, sourceName: file.name });
      } catch (e) {
        startTransition(() => setError(e instanceof IconError ? e.message : 'Could not process that image.'));
      }
    });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    handle(e.dataTransfer.files[0]);
  };

  return (
    <div>
      <label
        className={`drop${over ? ' drop--over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        title="Click or drop any image"
      >
        <ContainerIcon container={container} size={64} previewBlob={picked?.sizes[128]} />
        <span className="muted" style={{ fontSize: 11 }}>
          {processing ? 'Processing…' : 'Click or drop an image'}
        </span>
        <input
          type="file"
          accept="image/*"
          disabled={processing}
          onChange={(e) => {
            handle(e.target.files?.[0]);
            e.target.value = ''; // allow re-picking the same file
          }}
        />
      </label>
      {picked && (
        // Show the actual stored bitmaps at 1:1 so the user can judge the 16px result.
        <div className="drop__sizes" style={{ marginTop: 8 }} aria-label="Generated sizes">
          {([16, 32, 48] as const).map((s) => (
            <ContainerIcon key={s} container={container} size={s} previewBlob={picked.sizes[s]} />
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
