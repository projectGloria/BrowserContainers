// chrome.tabGroups only supports this fixed palette, so container colors are constrained to it.
// Using the same enum everywhere means the tab group color always matches the UI swatch.
export const CONTAINER_COLORS = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
] as const satisfies readonly `${chrome.tabGroups.Color}`[];

export type ContainerColor = (typeof CONTAINER_COLORS)[number];

// Approximate hex values of Chromium's tab-group colors, for rendering swatches/fallback icons.
export const COLOR_HEX: Record<ContainerColor, string> = {
  grey: '#5f6368',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#f9ab00',
  green: '#188038',
  pink: '#d01884',
  purple: '#a142f4',
  cyan: '#007b83',
  orange: '#fa903e',
};

export interface Container {
  id: string;
  name: string;
  color: ContainerColor;
  createdAt: number;
  // Bumped whenever the icon blob changes; 0 = no custom icon (letter fallback).
  // Lives in chrome.storage.local so every context gets a change event for free,
  // instead of a bespoke "icon changed" message.
  iconVersion: number;
}

export const ICON_SIZES = [16, 32, 48, 128] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export interface IconSet {
  containerId: string;
  sizes: Record<IconSize, Blob>;
  sourceName: string;
  updatedAt: number;
}
