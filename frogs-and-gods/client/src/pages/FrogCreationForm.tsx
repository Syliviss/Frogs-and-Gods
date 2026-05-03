import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import type { CreateFrogInput, FrogSpecies, FrogStatsDistribution } from "../../../shared/game.schema";

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const TOTAL_POINTS = 70;

interface SpeciesDef {
  label:     string;
  glyph:     string;
  modifiers: string;
  flavor:    string;
}

const SPECIES_DEFS: Record<FrogSpecies, SpeciesDef> = {
  BULL_FROG: {
    label:     "Bull Frog",
    glyph:     "B",
    modifiers: "+1 STR  +1 MaxHP",
    flavor:    "Thick-skulled. Hits harder. Takes a hit.",
  },
  TREE_FROG: {
    label:     "Tree Frog",
    glyph:     "T",
    modifiers: "+2 DEX",
    flavor:    "Sticky fingers. First to act, last to be seen.",
  },
  SHAMEN_FROG: {
    label:     "Shamen Frog",
    glyph:     "S",
    modifiers: "+1 MaxMana  +1 INT",
    flavor:    "Communes with the bog. Sees things others cannot.",
  },
  OLD_FROG: {
    label:     "Old Frog",
    glyph:     "O",
    modifiers: "-2 MaxHP  -2 STR  +3 WIS  +2 MaxMana",
    flavor:    "Weathered and wise. The pond remembers everything.",
  },
  GUIRO_FROG: {
    label:     "Guiro Frog",
    glyph:     "G",
    modifiers: "+4 CHA",
    flavor:    "Irresistible song. Gods pay attention when it speaks.",
  },
  POISON_DART_FROG: {
    label:     "Poison Dart Frog",
    glyph:     "P",
    modifiers: "No modifiers — pure base",
    flavor:    "Strikes clean. No favors from the divine.",
  },
};

const STAT_LABELS: Record<keyof FrogStatsDistribution, string> = {
  maxHp:   "Max HP",
  maxMana: "Max Mana",
  str:     "STR",
  dex:     "DEX",
  wis:     "WIS",
  int:     "INT",
  cha:     "CHA",
};

const STAT_KEYS = ["maxHp", "maxMana", "str", "dex", "wis", "int", "cha"] as const;

const DEFAULT_STATS: FrogStatsDistribution = {
  maxHp:   10,
  maxMana: 10,
  str:     10,
  dex:     10,
  wis:     10,
  int:     10,
  cha:     10,
};

// ─────────────────────────────────────────────
// REUSABLE PANEL
// ─────────────────────────────────────────────

interface FrogCreationPanelProps {
  onSubmit:   (data: CreateFrogInput) => void;
  isPending:  boolean;
  error?:     string | null;
  submitLabel?: string;
}

export function FrogCreationPanel({
  onSubmit,
  isPending,
  error,
  submitLabel = "[ Enter the Bog ]",
}: FrogCreationPanelProps) {
  const [name, setName]       = useState("");
  const [species, setSpecies] = useState<FrogSpecies>("POISON_DART_FROG");
  const [stats, setStats]     = useState<FrogStatsDistribution>({ ...DEFAULT_STATS });

  const pointsUsed      = STAT_KEYS.reduce((sum, k) => sum + stats[k], 0);
  const pointsRemaining = TOTAL_POINTS - pointsUsed;
  const canSubmit       = name.trim().length >= 2 && pointsRemaining === 0 && !isPending;

  function adjustStat(key: keyof FrogStatsDistribution, delta: number) {
    setStats((prev) => {
      const next = prev[key] + delta;
      if (next < 1) return prev;
      if (delta > 0 && pointsRemaining <= 0) return prev;
      return { ...prev, [key]: next };
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({ name: name.trim(), species, distributedStats: stats });
  }

  const selectedDef = SPECIES_DEFS[species];

  return (
    <form onSubmit={handleSubmit} className="space-y-4 font-mono text-[oklch(0.88_0.05_80)]">

      {/* ── Name ── */}
      <div className="border border-[oklch(0.25_0.03_240)] bg-[oklch(0.07_0.01_240)] p-3">
        <label className="block text-[oklch(0.55_0.06_80)] text-xs tracking-widest uppercase mb-2">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={64}
          placeholder="e.g. Ribbit the Brave"
          className="w-full bg-transparent border border-[oklch(0.22_0.03_240)] px-3 py-1.5 text-[oklch(0.88_0.05_80)] placeholder-[oklch(0.35_0.02_240)] focus:outline-none focus:border-[oklch(0.55_0.12_80)] text-sm"
        />
      </div>

      {/* ── Species ── */}
      <div className="border border-[oklch(0.25_0.03_240)] bg-[oklch(0.07_0.01_240)] p-3">
        <p className="text-[oklch(0.55_0.06_80)] text-xs tracking-widest uppercase mb-2">Species</p>
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(SPECIES_DEFS) as FrogSpecies[]).map((key) => {
            const def      = SPECIES_DEFS[key];
            const selected = species === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSpecies(key)}
                className={[
                  "border px-2 py-1.5 text-left transition-colors text-xs",
                  selected
                    ? "border-[oklch(0.65_0.14_80)] bg-[oklch(0.12_0.03_80)] text-[oklch(0.88_0.1_80)]"
                    : "border-[oklch(0.22_0.03_240)] text-[oklch(0.6_0.04_80)] hover:border-[oklch(0.4_0.08_80)]",
                ].join(" ")}
              >
                <span className="text-[oklch(0.65_0.14_80)] mr-1">[{def.glyph}]</span>
                {def.label}
              </button>
            );
          })}
        </div>
        <div className="mt-2 pt-2 border-t border-[oklch(0.18_0.02_240)] space-y-0.5">
          <p className="text-[oklch(0.65_0.14_80)] text-xs">{selectedDef.modifiers}</p>
          <p className="text-[oklch(0.45_0.03_80)] text-xs italic">{selectedDef.flavor}</p>
        </div>
      </div>

      {/* ── Stat Distribution ── */}
      <div className="border border-[oklch(0.25_0.03_240)] bg-[oklch(0.07_0.01_240)] p-3">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-[oklch(0.55_0.06_80)] text-xs tracking-widest uppercase">Distribute Points</p>
          <span className={[
            "text-sm font-bold tabular-nums",
            pointsRemaining === 0
              ? "text-[oklch(0.65_0.14_80)]"
              : pointsRemaining < 0
                ? "text-[oklch(0.6_0.18_20)]"
                : "text-[oklch(0.75_0.1_200)]",
          ].join(" ")}>
            {pointsRemaining} pts left
          </span>
        </div>

        <div className="space-y-1.5">
          {STAT_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-18 text-[oklch(0.6_0.05_80)] text-xs uppercase tracking-wide shrink-0 w-16">
                {STAT_LABELS[key]}
              </span>
              <button
                type="button"
                onClick={() => adjustStat(key, -1)}
                disabled={stats[key] <= 1}
                className="w-5 h-5 border border-[oklch(0.28_0.03_240)] text-[oklch(0.7_0.08_80)] hover:bg-[oklch(0.14_0.02_240)] disabled:opacity-30 disabled:cursor-not-allowed text-xs leading-none"
              >−</button>
              <span className="w-7 text-center text-[oklch(0.88_0.06_80)] text-sm tabular-nums font-bold">
                {stats[key]}
              </span>
              <button
                type="button"
                onClick={() => adjustStat(key, 1)}
                disabled={pointsRemaining <= 0}
                className="w-5 h-5 border border-[oklch(0.28_0.03_240)] text-[oklch(0.7_0.08_80)] hover:bg-[oklch(0.14_0.02_240)] disabled:opacity-30 disabled:cursor-not-allowed text-xs leading-none"
              >+</button>
              <div className="flex-1 h-px bg-[oklch(0.16_0.02_240)]">
                <div
                  className="h-px bg-[oklch(0.55_0.12_80)] transition-all"
                  style={{ width: `${Math.min(100, (stats[key] / 30) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <p className="text-[oklch(0.6_0.18_20)] text-xs border border-[oklch(0.3_0.1_20)] bg-[oklch(0.07_0.02_20)] px-3 py-2">
          ✗ {error}
        </p>
      )}

      {/* ── Submit ── */}
      <button
        type="submit"
        disabled={!canSubmit}
        className={[
          "w-full py-2.5 border text-xs tracking-widest uppercase transition-colors",
          canSubmit
            ? "border-[oklch(0.65_0.14_80)] text-[oklch(0.78_0.14_80)] hover:bg-[oklch(0.12_0.04_80)] cursor-pointer"
            : "border-[oklch(0.22_0.03_240)] text-[oklch(0.35_0.02_240)] cursor-not-allowed",
        ].join(" ")}
      >
        {isPending ? "[ Entering the Bog... ]" : submitLabel}
      </button>

      {pointsRemaining !== 0 && (
        <p className="text-center text-[oklch(0.4_0.03_80)] text-xs">
          {pointsRemaining > 0
            ? `Spend ${pointsRemaining} more point${pointsRemaining !== 1 ? "s" : ""} to continue.`
            : "Too many points distributed."}
        </p>
      )}
    </form>
  );
}

// ─────────────────────────────────────────────
// STANDALONE PAGE
// ─────────────────────────────────────────────

export default function FrogCreationFormPage() {
  const [, setLocation] = useLocation();
  const [error, setError] = useState<string | null>(null);

  const createFrog = trpc.frog.create.useMutation({
    onSuccess: () => setLocation("/game"),
    onError:   (e) => setError(e.message),
  });

  return (
    <div className="min-h-screen bg-black text-[oklch(0.88_0.05_80)] font-mono flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-6">
          <p className="text-[oklch(0.55_0.04_80)] text-xs tracking-widest mb-1">═══════════════════════════════</p>
          <h1 className="text-[oklch(0.78_0.14_80)] text-2xl tracking-widest uppercase">Spawn a Frog</h1>
          <p className="text-[oklch(0.55_0.04_80)] text-xs tracking-widest mt-1">═══════════════════════════════</p>
          <p className="text-[oklch(0.55_0.06_160)] text-xs mt-2 italic">
            The bog awaits. Choose wisely — death is permanent.
          </p>
        </div>
        <FrogCreationPanel
          onSubmit={(data) => { setError(null); createFrog.mutate(data); }}
          isPending={createFrog.isPending}
          error={error}
          submitLabel="[ Enter the Bog ]"
        />
      </div>
    </div>
  );
}
