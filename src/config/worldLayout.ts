// World-space layout. Ground is the XZ plane, Y is up. The field extends toward +Z,
// which is the top of the screen. Because the camera looks along +Z, screen-right is −X.

export interface Vec2 {
  x: number;
  z: number;
}

export interface Pad extends Vec2 {
  r: number;
}

export interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export const FIELD = {
  cols: 40,
  rows: 96,
  cell: 0.3,
  x0: -6,
  z0: 0,
  width: 12,
  length: 28.8,
  emptyRows: 4,
  /** Inclusive row ranges per tier. */
  tierRows: [
    [4, 35],
    [36, 65],
    [66, 95],
  ] as const,
  chunkCols: 20,
  chunkRows: 12,
};

export const HOSE_ANCHOR = { x: 0, y: 0.4, z: -1.4 };
export const TOOL_START: Vec2 = { x: 0, z: 0.7 };
export const TOOL_HEIGHT = 0.34;

export const MACHINE = { x: 0, z: -2.75, collider: { minX: -1.2, maxX: 1.2, minZ: -4.25, maxZ: -1.0 } as Aabb };

export const PADS = {
  harvest: { x: 0, z: -5.45, r: 0.9 } as Pad,
  depot: { x: -3.6, z: -5.8, r: 0.95 } as Pad,
  deliver: { x: -3.55, z: -10.45, r: 0.95 } as Pad,
  cash: { x: -0.7, z: -10.7, r: 0.85 } as Pad,
  upgrade: { x: 3.35, z: -7.25, r: 0.9 } as Pad,
  hauler: { x: 2.2, z: -10.4, r: 0.85 } as Pad,
};

/** Depot pallets (bales spread across them layer by layer). */
export const PALLETS: Vec2[] = [
  { x: -2.95, z: -3.95 },
  { x: -4.3, z: -3.95 },
  { x: -2.95, z: -2.55 },
  { x: -4.3, z: -2.55 },
];
export const PALLET_SIZE = 1.3;

export const CONVEYOR = { x0: -1.15, x1: -2.3, z: -3.25 };

export const WORKSHOP = { x: 3.8, z: -4.45, w: 2.5, d: 2.2 };

export const ROAD = { z: -12.9, width: 2.2 };

export const TRUCK_LAYOUT = {
  dockX: -3.3,
  z: -12.9,
  enterX: -26,
  exitX: 26,
  /** Truck faces +X: cab in front (+X), bed behind (bed centre = x − 0.62). */
  bedOffsetX: -0.62,
};

export const PLAYER_START: Vec2 = { x: 1.0, z: -6.7 };
export const PLAYER_RETURN_SPOT: Vec2 = { x: 1.1, z: -6.6 };

export const PLAYER_BOUNDS: Aabb = { minX: -5.45, maxX: 5.45, minZ: -11.75, maxZ: -0.95 };

export const HAULER_POINTS = {
  depot: { x: -4.75, z: -5.35 } as Vec2,
  truck: { x: -4.75, z: -11.25 } as Vec2,
  queue: { x: -4.55, z: -8.3 } as Vec2,
  idle: { x: -4.6, z: -6.95 } as Vec2,
  spawn: { x: 2.2, z: -10.4 } as Vec2,
};

export function palletColliders(): Aabb[] {
  const out: Aabb[] = [];
  const half = PALLET_SIZE / 2 + 0.02;
  for (let i = 0; i < PALLETS.length; i++) {
    const p = PALLETS[i];
    out.push({ minX: p.x - half, maxX: p.x + half, minZ: p.z - half, maxZ: p.z + half });
  }
  return out;
}

export const STATIC_COLLIDERS: Aabb[] = [
  MACHINE.collider,
  { minX: CONVEYOR.x1 - 0.1, maxX: CONVEYOR.x0, minZ: CONVEYOR.z - 0.35, maxZ: CONVEYOR.z + 0.35 },
  {
    minX: WORKSHOP.x - WORKSHOP.w / 2,
    maxX: WORKSHOP.x + WORKSHOP.w / 2,
    minZ: WORKSHOP.z - WORKSHOP.d / 2,
    maxZ: WORKSHOP.z + WORKSHOP.d / 2,
  },
];

export const CAMERA = {
  pitchDeg: 58,
  distance: 60,
  farmViewWidth: 9.8,
  harvestViewWidth: 9.4,
  transitionTime: 0.46,
  farmOffsetZ: 3.9,
  farmClamp: { minX: -0.9, maxX: 0.5, minZ: -4.6, maxZ: -2.0 },
  harvestLead: 3.0,
  harvestLookahead: 1.2,
  harvestVisibleMinZ: -8.2,
  harvestVisibleMaxZ: 30.2,
  harvestVisibleHalfX: 6.7,
};
