import { useActionState, useId, useState } from 'react';
import { createContainer, updateContainer } from '../shared/containersStore';
import { deleteIcon, putIcon } from '../shared/db';
import { saveContainerIcon } from '../shared/icons/saveIcon';
import { COLOR_HEX, CONTAINER_COLORS, type Container, type ContainerColor } from '../shared/types';
import { IconPicker, type PickedIcon } from './IconPicker';

const MAX_NAME = 40;

interface Props {
  initial?: Container; // undefined => create mode
  onDone?: () => void;
}

export function ContainerForm({ initial, onDone }: Props) {
  const nameId = useId();
  // Controlled only because the icon preview's letter fallback and color react live.
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState<ContainerColor>(initial?.color ?? 'blue');
  // null = untouched, 'remove' = revert to letter icon, PickedIcon = new upload.
  const [icon, setIcon] = useState<PickedIcon | 'remove' | null>(null);

  // React 19 form action: pending + error state come from the action itself,
  // instead of hand-rolled isSaving/error useStates toggled around an await.
  // React re-binds the latest action every render, so reading `icon` here isn't stale.
  const [error, submit, saving] = useActionState(async (_prev: string | null, form: FormData) => {
    const n = String(form.get('name') ?? '').trim();
    const c = String(form.get('color') ?? 'blue') as ContainerColor;
    if (!n) return 'Give the container a name.';
    try {
      const id = initial?.id ?? crypto.randomUUID();
      const picked = icon !== null && icon !== 'remove' ? icon : null;
      // Blob first, metadata second: the iconVersion bump is the "commit" every context reacts to.
      if (picked) await putIcon({ containerId: id, ...picked, updatedAt: Date.now() });
      if (icon === 'remove') await deleteIcon(id);
      const iconVersion = picked ? Date.now() : icon === 'remove' ? 0 : initial?.iconVersion ?? 0;

      if (initial) await updateContainer(id, { name: n, color: c, iconVersion });
      else await createContainer(n, c, { id, iconVersion });

      if (!initial) {
        setName('');
        setIcon(null);
      }
      onDone?.();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Save failed.';
    }
  }, null);

  // Derived, not stored: what the preview should render right now.
  const preview = {
    id: initial?.id ?? 'new',
    name: name || '?',
    color,
    iconVersion: icon === 'remove' ? 0 : initial?.iconVersion ?? 0,
  };
  const hasIcon = icon !== 'remove' && (icon !== null || preview.iconVersion > 0);

  return (
    <form className="form" action={submit}>
      <div>
        <IconPicker
          container={preview}
          picked={icon !== 'remove' ? icon : null}
          onPick={async (picked) => {
            if (initial) {
              await saveContainerIcon(initial.id, picked);
              setIcon(null);
            } else {
              setIcon(picked);
            }
          }}
        />
        {initial && <p className="muted form__note">Uploaded icons are saved immediately.</p>}
        {hasIcon && (
          <button type="button" className="btn btn--ghost muted" onClick={() => setIcon('remove')}>
            Remove icon
          </button>
        )}
      </div>

      <div className="form__fields">
        <label className="label" htmlFor={nameId}>
          Name
          <input
            id={nameId}
            className="input"
            name="name"
            value={name}
            maxLength={MAX_NAME}
            placeholder="Work, Personal, Banking…"
            onChange={(e) => setName(e.target.value)}
            autoFocus={!initial}
          />
        </label>

        <div className="label">
          Color
          <input type="hidden" name="color" value={color} />
          <div className="swatches" role="radiogroup" aria-label="Color">
            {CONTAINER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === color}
                aria-label={c}
                className="swatch"
                style={{ background: COLOR_HEX[c] }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="form__actions">
          <button className="btn btn--primary" disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save' : 'Create container'}
          </button>
          {onDone && initial && (
            <button type="button" className="btn" onClick={onDone}>
              Cancel
            </button>
          )}
        </div>
        {/* A picked image is draft state until submit; say so, or it looks already applied. */}
        {icon !== null && icon !== 'remove' && !initial && (
          <p className="muted form__note">The icon is saved when you click Create container.</p>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </form>
  );
}
