"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  DEFAULT_PROGRESS,
  DEFAULT_SETTINGS,
  GAME,
  Progress,
  Settings,
  SKINS,
  SkinId,
} from "./game-config";

type Screen =
  | "loading"
  | "menu"
  | "playing"
  | "paused"
  | "over"
  | "skins"
  | "progress"
  | "settings";
type Hud = { score: number; distance: number; multiplier: number; energy: number };
type RunResult = Hud & { shards: number; best: number };
type EntityKind = "shard" | "barrier" | "overhead" | "gate";
type Entity = {
  id: number;
  kind: EntityKind;
  lane: number;
  distance: number;
  checked?: boolean;
  pattern?: "rotate" | "shift" | "portal";
};

const load = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) || "{}") };
  } catch {
    return fallback;
  }
};

function Icon({ name }: { name: "pause" | "back" | "sound" | "spark" }) {
  return <span className={`icon icon-${name}`} aria-hidden="true" />;
}

class ToneBank {
  context?: AudioContext;
  volume = 0.7;
  enabled = true;

  setVolume(value: number) {
    this.volume = value;
  }

  play(type: "collect" | "jump" | "land" | "drift" | "hit" | "ui") {
    if (!this.enabled || this.volume <= 0) return;
    this.context ||= new AudioContext();
    const ctx = this.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const notes = {
      collect: [880, 1240],
      jump: [280, 520],
      land: [120, 75],
      drift: [220, 960],
      hit: [95, 42],
      ui: [420, 520],
    } as const;
    const [from, to] = notes[type];
    osc.type = type === "hit" ? "sawtooth" : "sine";
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(this.volume * 0.11, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.17);
  }
}

const AUDIO = new ToneBank();

function GameCanvas({
  skin,
  settings,
  paused,
  onHud,
  onFail,
  onPause,
}: {
  skin: SkinId;
  settings: Settings;
  paused: boolean;
  onHud: (hud: Hud) => void;
  onFail: (result: Omit<RunResult, "best">) => void;
  onPause: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const commandRef = useRef<((action: string) => void) | null>(null);
  const touchRef = useRef<{ x: number; y: number; at: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();
    let lane = 0;
    let x = 0;
    let jumpY = 0;
    let jumpV = 0;
    let slide = 0;
    let speed = GAME.startSpeed;
    let distance = 0;
    let score = 0;
    let multiplier = 1;
    let energy = 46;
    let shards = 0;
    let drift = 0;
    let transformation = 0;
    let district = 0;
    let spawnAt = 210;
    let entityId = 1;
    let gateIndex = 0;
    let failed = false;
    let hudTimer = 0;
    let prompt = "SWIPE TO MOVE";
    let promptTimer = 4.5;
    let flash = 0;
    let shake = 0;
    const entities: Entity[] = [];
    const particles: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];
    const stars = Array.from({ length: settings.reducedMotion ? 16 : 36 }, (_, i) => ({
      x: ((i * 73) % GAME.width) / GAME.width,
      y: ((i * 47) % 390) / 390,
      s: 0.4 + ((i * 19) % 12) / 10,
    }));

    const buzz = (pattern: number | number[]) => {
      if (settings.haptics && "vibrate" in navigator) navigator.vibrate(pattern);
    };

    const burst = (px: number, py: number, color: string, amount = 10) => {
      if (settings.reducedMotion) amount = Math.ceil(amount / 2);
      for (let i = 0; i < amount; i++) {
        const a = (Math.PI * 2 * i) / amount + Math.random() * 0.4;
        const velocity = 40 + Math.random() * 130;
        particles.push({
          x: px,
          y: py,
          vx: Math.cos(a) * velocity,
          vy: Math.sin(a) * velocity,
          life: 0.45 + Math.random() * 0.35,
          color,
        });
      }
    };

    const act = (action: string) => {
      if (failed) return;
      if (action === "left") {
        lane = Math.max(-1, lane - 1);
        promptTimer = 0;
      } else if (action === "right") {
        lane = Math.min(1, lane + 1);
        promptTimer = 0;
      } else if (action === "jump" && jumpY === 0 && slide <= 0) {
        jumpV = GAME.jumpVelocity;
        promptTimer = 0;
        AUDIO.play("jump");
      } else if (action === "slide" && jumpY < 10) {
        slide = GAME.slideDuration;
        promptTimer = 0;
      } else if (action === "drift" && energy >= GAME.driftCost && drift <= 0) {
        energy -= GAME.driftCost;
        drift = GAME.driftDuration;
        transformation = 1;
        flash = 0.48;
        shake = settings.reducedShake ? 1 : 7;
        AUDIO.play("drift");
        buzz([12, 25, 18]);
      }
    };
    commandRef.current = act;

    const keydown = (event: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Shift"].includes(event.key)) {
        event.preventDefault();
      }
      if (event.key === "ArrowLeft" || event.key.toLowerCase() === "a") act("left");
      if (event.key === "ArrowRight" || event.key.toLowerCase() === "d") act("right");
      if (event.key === "ArrowUp" || event.key === " " || event.key.toLowerCase() === "w") act("jump");
      if (event.key === "ArrowDown" || event.key.toLowerCase() === "s") act("slide");
      if (event.key === "Shift" || event.key.toLowerCase() === "e") act("drift");
      if (event.key === "Escape" || event.key.toLowerCase() === "p") onPause();
    };
    window.addEventListener("keydown", keydown, { passive: false });

    const spawnModule = () => {
      const elapsed = distance / 100;
      const safeIntro = elapsed < 35;
      const choice = Math.floor((Math.sin(entityId * 12.9898) + 1) * 50) % 5;
      if (safeIntro || choice <= 1) {
        const shardLane = ((entityId * 7) % 3) - 1;
        for (let i = 0; i < 4; i++) {
          entities.push({ id: entityId++, kind: "shard", lane: shardLane, distance: GAME.trackView + i * 96 });
        }
        if (!safeIntro) {
          const blocked = shardLane === -1 ? 1 : -1;
          entities.push({ id: entityId++, kind: "barrier", lane: blocked, distance: GAME.trackView + 135 });
        }
        spawnAt = 440;
      } else if (choice === 2) {
        const free = ((entityId * 5) % 3) - 1;
        [-1, 0, 1].filter((l) => l !== free).forEach((l) => {
          entities.push({ id: entityId++, kind: "barrier", lane: l, distance: GAME.trackView });
        });
        entities.push({ id: entityId++, kind: "shard", lane: free, distance: GAME.trackView + 55 });
        spawnAt = 410;
      } else if (choice === 3) {
        entities.push({ id: entityId++, kind: "overhead", lane: 0, distance: GAME.trackView });
        entities.push({ id: entityId++, kind: "shard", lane: -1, distance: GAME.trackView + 120 });
        entities.push({ id: entityId++, kind: "shard", lane: 1, distance: GAME.trackView + 215 });
        spawnAt = 470;
      } else {
        const patterns = ["rotate", "shift", "portal"] as const;
        const pattern = patterns[gateIndex++ % patterns.length];
        entities.push({ id: entityId++, kind: "gate", lane: 0, distance: GAME.trackView, pattern });
        spawnAt = 720;
        prompt = pattern === "rotate" ? "DRIFT TO ROTATE THE ROAD" : pattern === "shift" ? "DRIFT TO ALIGN" : "DRIFT THROUGH THE PORTAL";
        promptTimer = 5;
      }
    };

    const fail = () => {
      if (failed) return;
      failed = true;
      AUDIO.play("hit");
      buzz([45, 25, 80]);
      flash = 0.8;
      shake = settings.reducedShake ? 2 : 14;
      window.setTimeout(
        () => onFail({ score: Math.floor(score), distance: Math.floor(distance / 10), multiplier, energy, shards }),
        320,
      );
    };

    const project = (entityDistance: number) => {
      const p = Math.max(0, Math.min(1, 1 - entityDistance / GAME.trackView));
      const depth = p * p;
      return {
        p,
        y: GAME.horizon + depth * (GAME.playerY - GAME.horizon + 54),
        scale: 0.16 + p * 1.08,
        roadWidth: 42 + depth * 328,
      };
    };

    const rounded = (x0: number, y0: number, w: number, h: number, r: number) => {
      ctx.beginPath();
      ctx.roundRect(x0, y0, w, h, r);
    };

    const update = (dt: number) => {
      speed = Math.min(GAME.maxSpeed, speed + GAME.acceleration * dt);
      distance += speed * dt;
      score += speed * dt * 0.025 * multiplier;
      spawnAt -= speed * dt;
      if (spawnAt <= 0) spawnModule();

      const targetX = lane * GAME.laneWidth;
      x += (targetX - x) * Math.min(1, dt * 15);
      if (jumpV !== 0 || jumpY > 0) {
        jumpY += jumpV * dt;
        jumpV -= GAME.gravity * dt;
        if (jumpY <= 0) {
          if (jumpV < -200) {
            AUDIO.play("land");
            burst(GAME.width / 2 + x, GAME.playerY + 20, GAME.palette.cyan, 7);
          }
          jumpY = 0;
          jumpV = 0;
        }
      }
      slide = Math.max(0, slide - dt);
      drift = Math.max(0, drift - dt);
      transformation = Math.max(0, transformation - dt * 0.72);
      flash = Math.max(0, flash - dt * 2);
      shake = Math.max(0, shake - dt * 18);
      promptTimer = Math.max(0, promptTimer - dt);

      for (const entity of entities) {
        entity.distance -= speed * dt;
        if (entity.checked || entity.distance > GAME.collisionWindow || entity.distance < -GAME.collisionWindow) continue;
        entity.checked = true;
        const sameLane = Math.abs(lane - entity.lane) < 0.4;
        if (entity.kind === "shard" && sameLane) {
          shards++;
          energy = Math.min(100, energy + GAME.shardEnergy);
          score += 55 * multiplier;
          AUDIO.play("collect");
          burst(GAME.width / 2 + x, GAME.playerY - jumpY, GAME.palette.cyan, 12);
        } else if (entity.kind === "barrier") {
          if (sameLane && jumpY < 58) fail();
          else if (sameLane) {
            multiplier = Math.min(8, multiplier + 1);
            energy = Math.min(100, energy + GAME.nearMissEnergy);
            score += 75 * multiplier;
          }
        } else if (entity.kind === "overhead") {
          if (sameLane && slide <= 0.08) fail();
          else if (sameLane) {
            multiplier = Math.min(8, multiplier + 1);
            energy = Math.min(100, energy + GAME.nearMissEnergy);
          }
        } else if (entity.kind === "gate") {
          if (drift > 0) {
            multiplier = Math.min(8, multiplier + 1);
            score += 250 * multiplier;
            energy = Math.min(100, energy + 16);
            transformation = 1.35;
            district = (district + (entity.pattern === "portal" ? 1 : 0)) % 3;
            prompt = entity.pattern === "rotate" ? "ROAD ROTATED" : entity.pattern === "shift" ? "PATH ALIGNED" : "DISTRICT SHIFT";
            promptTimer = 1.4;
            burst(GAME.width / 2, GAME.horizon + 90, GAME.palette.violet, 24);
          } else {
            fail();
          }
        }
      }
      while (entities.length && entities[0].distance < -110) entities.shift();

      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 120 * dt;
        p.life -= dt;
      }
      while (particles.length && particles[0].life <= 0) particles.shift();

      hudTimer -= dt;
      if (hudTimer <= 0) {
        onHud({
          score: Math.floor(score),
          distance: Math.floor(distance / 10),
          multiplier,
          energy: Math.round(energy),
        });
        hudTimer = 0.1;
      }
    };

    const draw = (time: number) => {
      const skinData = SKINS[skin];
      const districtColor = [GAME.palette.cyan, GAME.palette.magenta, GAME.palette.violet][district];
      const sx = shake && !settings.reducedShake ? (Math.random() - 0.5) * shake : 0;
      const sy = shake && !settings.reducedShake ? (Math.random() - 0.5) * shake : 0;
      ctx.save();
      ctx.translate(sx, sy);

      const bg = ctx.createLinearGradient(0, 0, 0, GAME.height);
      bg.addColorStop(0, district === 1 ? "#12051b" : district === 2 ? "#0b061d" : "#050611");
      bg.addColorStop(0.6, "#080a19");
      bg.addColorStop(1, "#020309");
      ctx.fillStyle = bg;
      ctx.fillRect(-20, -20, GAME.width + 40, GAME.height + 40);

      for (const star of stars) {
        const y = (star.y * 380 + time * star.s * 0.003) % 380;
        ctx.fillStyle = `${districtColor}${Math.floor(60 + star.s * 70).toString(16).padStart(2, "0")}`;
        ctx.fillRect(star.x * GAME.width, y, star.s, star.s * 4);
      }

      const skylineShift = x * 0.12;
      for (let i = 0; i < 14; i++) {
        const w = 22 + ((i * 17) % 36);
        const h = 70 + ((i * 41) % 150);
        const bx = i * 38 - 64 - skylineShift;
        ctx.fillStyle = i % 2 ? "#0a1023" : "#0d0b20";
        ctx.fillRect(bx, GAME.horizon - h + 34, w, h);
        ctx.fillStyle = i % 3 === 0 ? `${GAME.palette.magenta}70` : `${districtColor}58`;
        for (let wy = GAME.horizon - h + 48; wy < GAME.horizon + 12; wy += 18) {
          ctx.fillRect(bx + 6, wy, 2, 7);
          ctx.fillRect(bx + w - 8, wy, 2, 7);
        }
      }

      ctx.save();
      const bend = transformation > 0 ? Math.sin((1 - transformation) * Math.PI) * 52 : 0;
      const tilt = transformation > 0 ? Math.sin((1 - transformation) * Math.PI) * 0.055 : 0;
      ctx.translate(bend, 0);
      ctx.rotate(tilt);

      ctx.beginPath();
      ctx.moveTo(GAME.width / 2 - 31, GAME.horizon);
      ctx.lineTo(8, GAME.height);
      ctx.lineTo(GAME.width - 8, GAME.height);
      ctx.lineTo(GAME.width / 2 + 31, GAME.horizon);
      ctx.closePath();
      const road = ctx.createLinearGradient(0, GAME.horizon, 0, GAME.height);
      road.addColorStop(0, "#13162a");
      road.addColorStop(1, "#070816");
      ctx.fillStyle = road;
      ctx.fill();
      ctx.strokeStyle = `${districtColor}d0`;
      ctx.lineWidth = 2;
      ctx.stroke();

      for (let i = 0; i < 18; i++) {
        const t = ((i / 18 + (distance % 120) / 120) % 1);
        const depth = t * t;
        const y = GAME.horizon + depth * (GAME.height - GAME.horizon);
        const half = 31 + depth * 165;
        ctx.strokeStyle = `${districtColor}${Math.floor(28 + depth * 55).toString(16)}`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(GAME.width / 2 - half, y);
        ctx.lineTo(GAME.width / 2 + half, y);
        ctx.stroke();
      }
      [-0.5, 0.5].forEach((divider) => {
        ctx.beginPath();
        ctx.moveTo(GAME.width / 2 + divider * 40, GAME.horizon);
        ctx.lineTo(GAME.width / 2 + divider * 220, GAME.height);
        ctx.strokeStyle = `${GAME.palette.violet}48`;
        ctx.setLineDash([16, 22]);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      });

      const sorted = [...entities].sort((a, b) => b.distance - a.distance);
      for (const entity of sorted) {
        if (entity.distance > GAME.trackView || entity.distance < -100) continue;
        const pr = project(entity.distance);
        const ex = GAME.width / 2 + entity.lane * GAME.laneWidth * pr.scale;
        const ey = pr.y;
        if (entity.kind === "shard") {
          const r = 8 * pr.scale;
          ctx.save();
          ctx.translate(ex, ey - 18 * pr.scale);
          ctx.rotate(time * 0.003);
          ctx.shadowBlur = 18 * pr.scale;
          ctx.shadowColor = GAME.palette.cyan;
          ctx.fillStyle = GAME.palette.cyan;
          ctx.beginPath();
          ctx.moveTo(0, -r * 1.7);
          ctx.lineTo(r, 0);
          ctx.lineTo(0, r * 1.7);
          ctx.lineTo(-r, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        } else if (entity.kind === "barrier") {
          const w = 46 * pr.scale;
          const h = 48 * pr.scale;
          ctx.shadowBlur = settings.highContrast ? 22 : 12;
          ctx.shadowColor = GAME.palette.coral;
          rounded(ex - w / 2, ey - h, w, h, 5 * pr.scale);
          ctx.fillStyle = settings.highContrast ? "#ff334f" : GAME.palette.coral;
          ctx.fill();
          ctx.fillStyle = "#16060b";
          ctx.fillRect(ex - w * 0.34, ey - h * 0.68, w * 0.68, h * 0.15);
        } else if (entity.kind === "overhead") {
          const w = 150 * pr.scale;
          const h = 24 * pr.scale;
          ctx.shadowBlur = 16;
          ctx.shadowColor = GAME.palette.coral;
          ctx.fillStyle = settings.highContrast ? "#ff334f" : GAME.palette.coral;
          rounded(ex - w / 2, ey - 74 * pr.scale, w, h, 4);
          ctx.fill();
          ctx.fillRect(ex - w / 2, ey - 74 * pr.scale, 8 * pr.scale, 74 * pr.scale);
          ctx.fillRect(ex + w / 2 - 8 * pr.scale, ey - 74 * pr.scale, 8 * pr.scale, 74 * pr.scale);
        } else {
          const size = 112 * pr.scale;
          ctx.save();
          ctx.translate(GAME.width / 2, ey - size * 0.1);
          ctx.rotate(entity.pattern === "rotate" ? time * 0.001 : 0);
          ctx.shadowBlur = 28 * pr.scale;
          ctx.shadowColor = GAME.palette.violet;
          ctx.strokeStyle = GAME.palette.violet;
          ctx.lineWidth = 8 * pr.scale;
          ctx.strokeRect(-size / 2, -size, size, size);
          ctx.strokeStyle = GAME.palette.cyan;
          ctx.lineWidth = 2 * pr.scale;
          ctx.strokeRect(-size * 0.39, -size * 0.89, size * 0.78, size * 0.78);
          ctx.restore();
        }
      }
      ctx.restore();

      if (!settings.reducedMotion && speed > 430) {
        ctx.strokeStyle = `${GAME.palette.cyan}2e`;
        for (let i = 0; i < 12; i++) {
          const lx = (i * 47 + time * 0.15) % GAME.width;
          const ly = 310 + ((i * 79 + time * 0.45) % 380);
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(lx + (lx - GAME.width / 2) * 0.08, ly + 55);
          ctx.stroke();
        }
      }

      const py = GAME.playerY - jumpY;
      ctx.save();
      ctx.translate(GAME.width / 2 + x, py);
      if (slide > 0) {
        ctx.rotate(-0.28);
        ctx.scale(1.2, 0.58);
      }
      ctx.shadowBlur = drift > 0 ? 34 : 20;
      ctx.shadowColor = drift > 0 ? GAME.palette.magenta : skinData.glow;
      ctx.fillStyle = skinData.body;
      rounded(-13, -48, 26, 44, 8);
      ctx.fill();
      ctx.fillStyle = GAME.palette.white;
      rounded(-9, -42, 18, 15, 5);
      ctx.fill();
      ctx.strokeStyle = skinData.glow;
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      const run = Math.sin(time * 0.018) * 8;
      ctx.beginPath();
      ctx.moveTo(-7, -7);
      ctx.lineTo(-11 - run, 15);
      ctx.moveTo(7, -7);
      ctx.lineTo(11 + run, 15);
      ctx.stroke();
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = skinData.body;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 58 + speed * 0.03);
      ctx.stroke();
      ctx.restore();

      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life * 1.4);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 3, 3);
      }
      ctx.globalAlpha = 1;

      if (promptTimer > 0) {
        ctx.font = "700 12px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.letterSpacing = "2px";
        const w = Math.min(280, ctx.measureText(prompt).width + 34);
        rounded(GAME.width / 2 - w / 2, 265, w, 34, 17);
        ctx.fillStyle = "#050611d9";
        ctx.fill();
        ctx.strokeStyle = `${GAME.palette.cyan}88`;
        ctx.stroke();
        ctx.fillStyle = GAME.palette.white;
        ctx.fillText(prompt, GAME.width / 2, 287);
      }

      if (drift > 0 || transformation > 0) {
        ctx.strokeStyle = `${GAME.palette.magenta}${Math.floor(55 * Math.min(1, drift + transformation)).toString(16)}`;
        ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, GAME.width - 10, GAME.height - 10);
      }
      if (flash > 0) {
        ctx.fillStyle = `${drift > 0 ? GAME.palette.violet : GAME.palette.coral}${Math.floor(flash * 90).toString(16).padStart(2, "0")}`;
        ctx.fillRect(0, 0, GAME.width, GAME.height);
      }
      ctx.restore();
    };

    const loop = (now: number) => {
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      if (!paused && !failed) update(dt);
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", keydown);
      commandRef.current = null;
    };
  }, [onFail, onHud, onPause, paused, settings, skin]);

  const command = (action: string) => commandRef.current?.(action);
  return (
    <div
      className="game-surface"
      onPointerDown={(e) => {
        touchRef.current = { x: e.clientX, y: e.clientY, at: Date.now() };
      }}
      onPointerUp={(e) => {
        const start = touchRef.current;
        touchRef.current = null;
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 28) command(dx > 0 ? "right" : "left");
        else if (Math.abs(dy) > 28) command(dy < 0 ? "jump" : "slide");
      }}
    >
      <canvas
        ref={canvasRef}
        width={GAME.width}
        height={GAME.height}
        aria-label="Neon Drift gameplay. Swipe or use arrow keys to move."
      />
      <div className="touch-controls" aria-label="Game controls">
        <button className="drift-button" onPointerDown={() => command("drift")} aria-label="Activate Drift">
          <span>DRIFT</span>
          <small>SHIFT / E</small>
        </button>
        <div className="move-controls">
          <button onPointerDown={() => command("left")} aria-label="Move left">‹</button>
          <button onPointerDown={() => command("jump")} aria-label="Jump">↑</button>
          <button onPointerDown={() => command("right")} aria-label="Move right">›</button>
        </div>
      </div>
    </div>
  );
}

function TopBar({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="subpage-head">
      <button className="icon-button" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
      <strong>{label}</strong>
      <span className="head-line" />
    </div>
  );
}

export function NeonDrift() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [hud, setHud] = useState<Hud>({ score: 0, distance: 0, multiplier: 1, energy: 46 });
  const [result, setResult] = useState<RunResult | null>(null);
  const [settings, setSettings] = useState<Settings>(() => load("neon-drift-settings", DEFAULT_SETTINGS));
  const [progress, setProgress] = useState<Progress>(() => load("neon-drift-progress", DEFAULT_PROGRESS));
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setScreen("menu"), 1100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    AUDIO.setVolume(settings.sfx);
    localStorage.setItem("neon-drift-settings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem("neon-drift-progress", JSON.stringify(progress));
  }, [progress]);

  useEffect(() => {
    const visibility = () => {
      if (document.hidden && screen === "playing") setScreen("paused");
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", visibility);
    };
  }, [screen]);

  const start = () => {
    AUDIO.play("ui");
    setHud({ score: 0, distance: 0, multiplier: 1, energy: 46 });
    setResult(null);
    setRunKey((value) => value + 1);
    setScreen("playing");
  };

  const fail = useCallback((run: Omit<RunResult, "best">) => {
    setProgress((old) => {
      const best = Math.max(old.best, run.score);
      const totalDistance = old.totalDistance + run.distance;
      const shards = old.shards + run.shards;
      const achievements = [...old.achievements];
      if (run.score >= 1500 && !achievements.includes("first-light")) achievements.push("first-light");
      if (run.multiplier >= 5 && !achievements.includes("flow-state")) achievements.push("flow-state");
      if (totalDistance >= 5000 && !achievements.includes("night-shift")) achievements.push("night-shift");
      setResult({ ...run, best });
      return { ...old, best, totalDistance, shards, achievements };
    });
    setScreen("over");
  }, []);
  const pauseRun = useCallback(() => setScreen("paused"), []);

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((old) => ({ ...old, [key]: value }));

  const selectSkin = (id: SkinId) => {
    const skin = SKINS[id];
    if (progress.unlocked.includes(id)) {
      setProgress((old) => ({ ...old, selectedSkin: id }));
      AUDIO.play("ui");
    } else if (progress.shards >= skin.cost) {
      setProgress((old) => ({
        ...old,
        shards: old.shards - skin.cost,
        selectedSkin: id,
        unlocked: [...old.unlocked, id],
      }));
      AUDIO.play("drift");
    }
  };

  return (
    <main className={`app-shell district-${progress.selectedSkin}`}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <section className="game-phone" aria-live="polite">
        {screen === "loading" && (
          <div className="loading-screen">
            <div className="load-mark"><span /><span /><span /></div>
            <p>CALIBRATING REALITY</p>
            <div className="load-track"><i /></div>
          </div>
        )}

        {screen === "menu" && (
          <div className="menu-screen">
            <div className="menu-city" aria-hidden="true">
              {Array.from({ length: 11 }, (_, i) => <i key={i} />)}
            </div>
            <header className="brand-block">
              <span className="eyebrow">REALITY // RUNNER</span>
              <h1><span>NEON</span> DRIFT</h1>
              <p>The city moves with you.</p>
            </header>
            <div className="runner-mark" aria-hidden="true">
              <i className="runner-head" />
              <i className="runner-body" />
              <i className="runner-trail" />
            </div>
            <div className="menu-actions">
              <button className="primary-button" onClick={start}>
                <span>START RUN</span>
                <small>Tap to enter the city</small>
              </button>
              <div className="menu-grid">
                <button onClick={() => setScreen("skins")}><span className="mini-glyph glyph-hex" />LOADOUT</button>
                <button onClick={() => setScreen("progress")}><span className="mini-glyph glyph-bars" />CHALLENGES</button>
                <button onClick={() => setScreen("settings")}><span className="mini-glyph glyph-dial" />SETTINGS</button>
              </div>
            </div>
            <footer className="menu-stats">
              <span><small>BEST</small>{progress.best.toLocaleString()}</span>
              <i />
              <span><small>SHARDS</small>{progress.shards}</span>
            </footer>
          </div>
        )}

        {(screen === "playing" || screen === "paused") && (
          <div className="play-screen">
            <GameCanvas
              key={runKey}
              skin={progress.selectedSkin}
              settings={settings}
              paused={screen === "paused"}
              onHud={setHud}
              onFail={fail}
              onPause={pauseRun}
            />
            <div className="hud">
              <div className="hud-top">
                <div className="score-block"><small>SCORE</small><strong>{hud.score.toString().padStart(6, "0")}</strong></div>
                <div className="distance-block"><strong>{hud.distance}</strong><small>M</small></div>
                <button className="pause-button" onClick={pauseRun} aria-label="Pause"><Icon name="pause" /></button>
              </div>
              <div className="hud-bottom">
                <div className="multiplier"><small>FLOW</small><strong>×{hud.multiplier}</strong></div>
                <div className="energy">
                  <div className="energy-label"><span>DRIFT ENERGY</span><b>{hud.energy}%</b></div>
                  <div className="energy-track"><i style={{ width: `${hud.energy}%` }} /></div>
                </div>
              </div>
            </div>
            {screen === "paused" && (
              <div className="modal-backdrop">
                <div className="glass-card pause-card">
                  <span className="eyebrow">RUN SUSPENDED</span>
                  <h2>PAUSED</h2>
                  <button className="primary-button compact" onClick={() => setScreen("playing")}>RESUME</button>
                  <button className="secondary-button" onClick={() => setScreen("menu")}>END RUN</button>
                  <p>ARROWS / SWIPE · SPACE / ↑ · SHIFT / E</p>
                </div>
              </div>
            )}
          </div>
        )}

        {screen === "over" && result && (
          <div className="results-screen">
            <div className="result-flare" />
            <span className="eyebrow">SIGNAL LOST</span>
            <h2>RUN COMPLETE</h2>
            <div className="result-score">
              <small>FINAL SCORE</small>
              <strong>{result.score.toLocaleString()}</strong>
              {result.score >= result.best && result.score > 0 && <span>NEW BEST</span>}
            </div>
            <div className="result-grid">
              <div><small>DISTANCE</small><strong>{result.distance}m</strong></div>
              <div><small>SHARDS</small><strong>+{result.shards}</strong></div>
              <div><small>MAX FLOW</small><strong>×{result.multiplier}</strong></div>
            </div>
            <div className="result-actions">
              <button className="primary-button" onClick={start}><span>RUN AGAIN</span><small>Reality is waiting</small></button>
              <button className="secondary-button" onClick={() => setScreen("menu")}>MAIN MENU</button>
            </div>
          </div>
        )}

        {screen === "skins" && (
          <div className="subpage">
            <TopBar label="LOADOUT" onBack={() => setScreen("menu")} />
            <div className="subpage-intro"><span className="eyebrow">RIDER SIGNAL</span><h2>CHOOSE YOUR GLOW</h2><p>Skins are visual only. Skill stays yours.</p></div>
            <div className="skin-list">
              {(Object.entries(SKINS) as [SkinId, (typeof SKINS)[SkinId]][]).map(([id, skin]) => {
                const unlocked = progress.unlocked.includes(id);
                const active = progress.selectedSkin === id;
                return (
                  <button key={id} className={`skin-card ${active ? "active" : ""}`} onClick={() => selectSkin(id)}>
                    <span className="skin-orb" style={{ "--skin": skin.body, "--glow": skin.glow } as CSSProperties}><i /></span>
                    <span><small>{unlocked ? active ? "EQUIPPED" : "UNLOCKED" : `${skin.cost} SHARDS`}</small><strong>{skin.name}</strong></span>
                    <b>{active ? "✓" : unlocked ? "USE" : "UNLOCK"}</b>
                  </button>
                );
              })}
            </div>
            <div className="wallet"><Icon name="spark" /> {progress.shards} ENERGY SHARDS</div>
          </div>
        )}

        {screen === "progress" && (
          <div className="subpage">
            <TopBar label="CHALLENGES" onBack={() => setScreen("menu")} />
            <div className="subpage-intro"><span className="eyebrow">LOCAL PROGRESSION</span><h2>OWN THE NIGHT</h2><p>Every run leaves a trace.</p></div>
            <div className="daily-card">
              <small>DAILY SIGNAL · {new Date().toLocaleDateString(undefined, { weekday: "short", day: "2-digit" }).toUpperCase()}</small>
              <strong>Collect 20 shards in one run</strong>
              <div><i style={{ width: `${Math.min(100, progress.shards * 5)}%` }} /></div>
              <span>{Math.min(20, progress.shards)} / 20</span>
            </div>
            <div className="achievement-list">
              {[
                ["first-light", "FIRST LIGHT", "Score 1,500 in a run"],
                ["flow-state", "FLOW STATE", "Reach a ×5 multiplier"],
                ["night-shift", "NIGHT SHIFT", "Run 5,000m total"],
              ].map(([id, title, copy]) => (
                <div className={progress.achievements.includes(id) ? "unlocked" : ""} key={id}>
                  <span className="achievement-glyph">{progress.achievements.includes(id) ? "◆" : "◇"}</span>
                  <p><strong>{title}</strong><small>{copy}</small></p>
                  <b>{progress.achievements.includes(id) ? "DONE" : "LOCKED"}</b>
                </div>
              ))}
            </div>
            <div className="lifetime"><span><small>TOTAL DISTANCE</small>{progress.totalDistance.toLocaleString()}m</span><span><small>BEST SCORE</small>{progress.best.toLocaleString()}</span></div>
          </div>
        )}

        {screen === "settings" && (
          <div className="subpage settings-page">
            <TopBar label="SETTINGS" onBack={() => setScreen("menu")} />
            <div className="subpage-intro"><span className="eyebrow">SYSTEM CALIBRATION</span><h2>MAKE IT YOURS</h2></div>
            <div className="settings-list">
              <label><span><strong>MUSIC</strong><small>Synthwave soundtrack hook</small></span><input aria-label="Music volume" type="range" min="0" max="1" step=".05" value={settings.music} onChange={(e) => updateSetting("music", Number(e.target.value))} /></label>
              <label><span><strong>SOUND EFFECTS</strong><small>Actions and impact</small></span><input aria-label="Sound effects volume" type="range" min="0" max="1" step=".05" value={settings.sfx} onChange={(e) => updateSetting("sfx", Number(e.target.value))} /></label>
              {([
                ["reducedShake", "REDUCED CAMERA SHAKE", "Softens impact motion"],
                ["reducedMotion", "REDUCED EFFECTS", "Fewer particles and speed lines"],
                ["highContrast", "HIGH-CONTRAST HAZARDS", "Brighter coral obstacles"],
                ["haptics", "HAPTIC FEEDBACK", "Where supported"],
              ] as [keyof Settings, string, string][]).map(([key, title, copy]) => (
                <label className="toggle-row" key={key}>
                  <span><strong>{title}</strong><small>{copy}</small></span>
                  <input type="checkbox" checked={Boolean(settings[key])} onChange={(e) => updateSetting(key, e.target.checked as never)} />
                  <i />
                </label>
              ))}
            </div>
            <p className="version">NEON DRIFT // PROTOTYPE 1.0</p>
          </div>
        )}
      </section>
      <p className="desktop-note">SWIPE TO MOVE · TAP DRIFT TO TRANSFORM REALITY</p>
    </main>
  );
}
