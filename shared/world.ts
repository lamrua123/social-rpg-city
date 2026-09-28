export const WORLD = { width: 1728, height: 1184, tile: 32 } as const;

export type Rect = { x: number; y: number; width: number; height: number };

// Shared with the server so guests cannot move through solid landmarks by sending edited coordinates.
export const SOLID_AREAS: Rect[] = [
  // Building footprints follow the hand-painted map artwork (scaled to WORLD).
  { x: 84, y: 36, width: 358, height: 284 },
  { x: 1040, y: 40, width: 386, height: 374 },
  { x: 0, y: 331, width: 455, height: 334 },
  { x: 918, y: 778, width: 312, height: 324 },
  // Fountain basin.
  { x: 690, y: 432, width: 230, height: 124 },
  // Riverbanks leave a clear crossing over the wooden bridge.
  { x: 1590, y: 0, width: 138, height: 580 },
  { x: 1515, y: 504, width: 213, height: 110 },
  { x: 1634, y: 782, width: 94, height: 402 },
  { x: 1478, y: 864, width: 250, height: 320 },
  // Large tree trunks and the outer stone boundary.
  { x: 170, y: 876, width: 112, height: 86 },
  { x: 706, y: 94, width: 112, height: 96 },
  { x: 1031, y: 746, width: 94, height: 90 },
  { x: 1498, y: 0, width: 36, height: 64 },
];

export function canStandAt(x: number, y: number, radius = 13): boolean {
  if (x < radius + 16 || y < radius + 16 || x > WORLD.width - radius - 16 || y > WORLD.height - radius - 16) return false;
  return !SOLID_AREAS.some((area) =>
    x + radius > area.x && x - radius < area.x + area.width &&
    y + radius > area.y && y - radius < area.y + area.height,
  );
}

export function clampToWalkable(previous: { x: number; y: number }, x: number, y: number): { x: number; y: number } {
  if (canStandAt(x, y)) return { x, y };
  const horizontal = canStandAt(x, previous.y) ? { x, y: previous.y } : null;
  const vertical = canStandAt(previous.x, y) ? { x: previous.x, y } : null;
  return horizontal ?? vertical ?? previous;
}
