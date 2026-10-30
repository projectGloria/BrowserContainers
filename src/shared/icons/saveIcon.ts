import { updateContainer } from '../containersStore';
import { putIcon } from '../db';
import type { IconSize } from '../types';

export async function saveContainerIcon(
  containerId: string,
  icon: { sizes: Record<IconSize, Blob>; sourceName: string },
): Promise<void> {
  const version = Date.now();
  // Publish the version only after the image transaction has committed.
  await putIcon({ containerId, ...icon, updatedAt: version });
  await updateContainer(containerId, { iconVersion: version });
}
