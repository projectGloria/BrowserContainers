import { COLOR_HEX, type Container, type IconSize } from '../shared/types';
import { useObjectUrl, useStoredIconUrl } from './hooks';

interface Props {
  container: Pick<Container, 'id' | 'name' | 'color' | 'iconVersion'>;
  // Display size in CSS px. We pick the stored bitmap that's >= display size * DPR,
  // so 24px on a 2x screen uses the 48px PNG instead of upscaling the 32px one.
  size?: number;
  // Explicit blob for live previews (not yet saved to IDB).
  previewBlob?: Blob;
}

function pickSource(px: number): IconSize {
  const need = px * (globalThis.devicePixelRatio || 1);
  return need <= 16 ? 16 : need <= 32 ? 32 : need <= 48 ? 48 : 128;
}

export function ContainerIcon({ container, size = 24, previewBlob }: Props) {
  // Saved icons come from the shared per-context URL cache; unsaved previews get a URL of
  // their own that's revoked when the preview goes away.
  const stored = useStoredIconUrl(container.id, previewBlob ? 0 : container.iconVersion, pickSource(size));
  const preview = useObjectUrl(previewBlob);
  const url = previewBlob ? preview : stored;

  if (url) {
    return <img className="cicon" src={url} width={size} height={size} alt="" draggable={false} />;
  }
  return (
    <span
      className="cicon cicon--letter"
      style={{ width: size, height: size, background: COLOR_HEX[container.color], fontSize: size * 0.55 }}
      aria-hidden
    >
      {(container.name[0] ?? '?').toUpperCase()}
    </span>
  );
}
