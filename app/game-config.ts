export const GAME = {
  width: 390,
  height: 844,
  horizon: 184,
  playerY: 696,
  laneWidth: 86,
  startSpeed: 320,
  maxSpeed: 610,
  acceleration: 3.7,
  trackView: 1550,
  jumpVelocity: 760,
  gravity: 2050,
  slideDuration: 0.72,
  driftCost: 34,
  driftDuration: 1.05,
  collisionWindow: 42,
  shardEnergy: 8,
  nearMissEnergy: 4,
  palette: {
    navy: "#050611",
    cyan: "#38f9ff",
    violet: "#9b5cff",
    magenta: "#ff3bd4",
    coral: "#ff5f72",
    mint: "#79ffd3",
    white: "#f6f7ff",
  },
} as const;

export type SkinId = "ion" | "pulse" | "flare";

export const SKINS: Record<
  SkinId,
  { name: string; body: string; glow: string; cost: number }
> = {
  ion: { name: "ION", body: "#38f9ff", glow: "#9b5cff", cost: 0 },
  pulse: { name: "PULSE", body: "#ff3bd4", glow: "#38f9ff", cost: 80 },
  flare: { name: "FLARE", body: "#ff8d5b", glow: "#ffd166", cost: 180 },
};

export type Settings = {
  music: number;
  sfx: number;
  reducedShake: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  haptics: boolean;
};

export type Progress = {
  best: number;
  totalDistance: number;
  shards: number;
  unlocked: SkinId[];
  selectedSkin: SkinId;
  achievements: string[];
};

export const DEFAULT_SETTINGS: Settings = {
  music: 0.45,
  sfx: 0.7,
  reducedShake: false,
  reducedMotion: false,
  highContrast: false,
  haptics: true,
};

export const DEFAULT_PROGRESS: Progress = {
  best: 0,
  totalDistance: 0,
  shards: 0,
  unlocked: ["ion"],
  selectedSkin: "ion",
  achievements: [],
};
