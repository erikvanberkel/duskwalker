// Screen layout shared by the asset generator and (through the generated header) the C code.
export const SCREEN_W = 320, SCREEN_H = 256;
export const PX_PER_UNIT = 18;          // pixels per world unit on the walking plane
export const HORIZON_Y = 140;           // vanishing line of the floor
export const PATH_Y = 216;              // feet of the wanderer (walking plane, depth factor 1)
export const TREE_FACTOR = 0.42;        // PF2 tree ribbon parallax (giant trees ~20 units behind the path)
export const TREE_BASE_Y = Math.round(HORIZON_Y + TREE_FACTOR * (PATH_Y - HORIZON_Y));
export const MAX_CAM_PX = 16600;
// foreground grass: the bottom lines of playfield 2 show a periodic strip of blades that scrolls faster
// than the path (it stands nearer the camera); the copper switches PF2 to it with a modulo jump
export const FG_Y = 222, FG_FACTOR = 1.45, FG_PERIOD = 512;        // camera travel in walking-plane pixels (level length 905 units)

// Bands of playfield 1, top to bottom, plus overlays. Factor = parallax relative to the walking plane.
export const STACK = [
  { name: 'HUD', y0: 0, rows: 18, factor: 0 },
  { name: 'SKY', y0: 18, rows: 94, factor: 0.004 },
  // the middle tree layer: forest standing on the horizon (where the floor moves at the same 0.13), drawn
  // over the three nearer hills, which it carries as its backdrop
  { name: 'TREES', y0: 112, rows: 38, factor: 0.13 },
  { name: 'GROUND', y0: 150, rows: 106, factor: 1, period: 384 },
];
export const OVERLAYS = [
  { name: 'PAUSE', y0: 104, rows: 34 },
  { name: 'BOSS', y0: 234, rows: 22 },
];
export const groundFactor = (row) => (STACK.find((d) => d.name === 'GROUND').y0 + row - HORIZON_Y) / (PATH_Y - HORIZON_Y);
