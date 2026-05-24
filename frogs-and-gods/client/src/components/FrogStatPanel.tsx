import { useRef, useEffect } from "react";
import type { Frog, Item, FrogStats } from "../../../drizzle/schema";
import type { SpriteManager } from "@/lib/SpriteManager";

interface Props {
  frog:              Frog | null;
  equippedItems:     Item[];
  frogSpriteManager: SpriteManager;
  spriteVersion:     number;
}

interface PixelIconProps {
  pixelData: (string | null)[] | null | undefined;
  name:      string;
  size?:     number;
}

function PixelIcon({ pixelData, name, size = 32 }: PixelIconProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current || !pixelData) return;
    const ctx = ref.current.getContext("2d");
    if (!ctx) return;
    const scale = size / 16;
    ctx.clearRect(0, 0, size, size);
    for (let i = 0; i < pixelData.length; i++) {
      const px = pixelData[i];
      if (!px || px === "#00000000") continue;
      ctx.fillStyle = px;
      ctx.fillRect((i % 16) * scale, Math.floor(i / 16) * scale, scale, scale);
    }
  }, [pixelData, size]);

  return (
    <div className="item-slot" title={name}>
      <canvas ref={ref} width={size} height={size} className="pixel-canvas" />
    </div>
  );
}

export function FrogStatPanel({ frog, equippedItems, frogSpriteManager, spriteVersion }: Props) {
  const spriteRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!frog || !spriteRef.current) return;
    const baked = frogSpriteManager.get(String(frog.id));
    if (!baked) return;
    const ctx = spriteRef.current.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 64, 64);
    ctx.drawImage(baked, 0, 0, 64, 64);
  }, [frog?.id, spriteVersion, frogSpriteManager]);

  if (!frog) return null;

  const stats = frog.statsJson as FrogStats | null;
  const maxHp       = stats?.maxHp       ?? 100;
  const maxMana     = stats?.maxMana     ?? 50;
  const maxBreath   = stats?.maxBreath   ?? 5;
  const equipCap    = stats?.equipCapacity ?? 3;

  const { currentHp, currentMana, currentBreath, currentXp, xpToNextLevel, level } = frog;

  const maxPool = Math.max(maxHp, maxMana, maxBreath);

  const bars = [
    { label: "HP",  current: currentHp,     max: maxHp,     color: "var(--hp-color)", bg: "var(--hp-bg)" },
    { label: "MP",  current: currentMana,   max: maxMana,   color: "var(--mp-color)", bg: "var(--mp-bg)" },
    { label: "BRE", current: currentBreath, max: maxBreath, color: "#17A67B",         bg: "rgba(23,166,123,0.15)" },
  ];

  const xpPct = xpToNextLevel > 0 ? Math.min((currentXp / xpToNextLevel) * 100, 100) : 0;

  return (
    <div className="stat-panel">
      {/* Frog sprite + resource bars */}
      <div className="flex gap-3 items-center">
        <canvas
          ref={spriteRef}
          width={64}
          height={64}
          className="pixel-canvas flex-shrink-0"
        />

        <div className="flex flex-col gap-2 flex-1">
          {bars.map(bar => {
            const trackPct = maxPool > 0 ? (bar.max / maxPool) * 100 : 100;
            const fillPct  = bar.max  > 0 ? (bar.current / bar.max) * 100 : 0;
            return (
              <div key={bar.label} className="flex items-center gap-1.5">
                <span className="stat-label-name">{bar.label}</span>
                <div className="flex-1">
                  <div
                    className="stat-bar"
                    style={{ width: `${trackPct}%`, background: bar.bg }}
                  >
                    <div
                      className="stat-bar-fill"
                      style={{ width: `${fillPct}%`, background: bar.color }}
                    />
                  </div>
                </div>
                <span className="stat-label-val">{bar.current}/{bar.max}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Equipment slots */}
      <div className="flex gap-2">
        {Array.from({ length: equipCap }).map((_, i) => {
          const item = equippedItems[i];
          return item
            ? <PixelIcon key={item.itemId} pixelData={item.pixelData} name={item.name} />
            : <div key={i} className="item-slot" />;
        })}
      </div>

      {/* XP bar — independent scale, centered at 80% width */}
      <div className="xp-section">
        <div className="stat-bar xp-bar">
          <div
            className="stat-bar-fill"
            style={{ width: `${xpPct}%`, background: "var(--xp-color)" }}
          />
        </div>
        <div className="stat-xp-label">Lv.{level} · {currentXp}/{xpToNextLevel}</div>
      </div>
    </div>
  );
}
