import { useEffect, useState, useSyncExternalStore } from 'react';
import { getSnapshot, isLoaded, subscribe } from '../shared/containersStore';
import { getIcon } from '../shared/db';
import { getSettingsSnapshot, subscribeSettings, type Settings } from '../shared/settings';
import type { Container, IconSize } from '../shared/types';

// chrome.storage is the source of truth; React just reads it. useSyncExternalStore gives
// tear-free reads under concurrent rendering. A useState+useEffect mirror would need its own
// sync logic and render one frame of stale data after every change.
export function useContainers(): readonly Container[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useContainersLoaded(): boolean {
  return useSyncExternalStore(subscribe, isLoaded);
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettingsSnapshot);
}

// Object URLs pin the Blob in memory until revoked. Creating one during render would leak
// under StrictMode's double render and on every re-render, so create/revoke in an effect,
// keyed by the Blob's identity.
export function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

// One object URL per (container, iconVersion, size) per JS context, shared by every
// <ContainerIcon>. The popup renders a container's icon on every bookmark row: without the
// cache that's one IDB read + one Blob URL per row. The key carries iconVersion, so an icon
// change is a cache miss by construction; superseded URLs are revoked so they don't pin Blobs.
const iconUrls = new Map<string, Promise<string | undefined>>();

function storedIconUrl(containerId: string, iconVersion: number, size: IconSize): Promise<string | undefined> {
  const key = `${containerId}:${iconVersion}:${size}`;
  let p = iconUrls.get(key);
  if (p) return p;
  for (const [k, old] of iconUrls) {
    if (k.startsWith(`${containerId}:`) && !k.startsWith(`${containerId}:${iconVersion}:`)) {
      iconUrls.delete(k);
      void old.then((u) => u && URL.revokeObjectURL(u));
    }
  }
  p = getIcon(containerId).then((icon) => {
    const blob = icon?.sizes[size];
    return blob ? URL.createObjectURL(blob) : undefined;
  });
  p.catch(() => iconUrls.delete(key)); // a failed read shouldn't stick for the page's lifetime
  iconUrls.set(key, p);
  return p;
}

export function useStoredIconUrl(containerId: string, iconVersion: number, size: IconSize): string | undefined {
  const key = `${containerId}:${iconVersion}:${size}`;
  // The result is tagged with the key it was loaded for, and only returned while the key still
  // matches. That derives "loading" from props instead of a reset-to-undefined effect, which
  // would flash the previous container's icon for one render after a prop change.
  const [loaded, setLoaded] = useState<{ key: string; url: string | undefined }>();
  useEffect(() => {
    if (iconVersion === 0) return;
    let stale = false;
    storedIconUrl(containerId, iconVersion, size).then(
      (url) => !stale && setLoaded({ key, url }),
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [containerId, iconVersion, size, key]);
  return iconVersion !== 0 && loaded?.key === key ? loaded.url : undefined;
}
