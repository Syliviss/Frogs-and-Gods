import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import type { ActionLogEntry } from "../../../shared/game.schema";
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
// LAIR SELECTION STEP
// ─────────────────────────────────────────────

interface LairOption {
  instanceId:    number;
  entranceGridX: number;
  entranceGridY: number;
  godName:       string;
  godFavor:      number;
}

interface LairSelectionProps {
  onSelect: (lairInstanceId: number | null) => void;
}

function LairSelectionStep({ onSelect }: LairSelectionProps) {
  const { data: lairs, isLoading } = trpc.frog.getRandomLairs.useQuery({ count: 5 });
  const [manualId, setManualId]    = useState("");
  const [selected, setSelected]    = useState<number | null | "NONE">(undefined as unknown as null);

  const manualIdNum = parseInt(manualId, 10);
  const manualValid = manualId.trim() !== "" && !isNaN(manualIdNum) && manualIdNum > 0;

  const effectiveSelection = manualValid ? manualIdNum : selected;
  const canContinue = effectiveSelection !== (undefined as unknown as null);

  function handleContinue() {
    if (!canContinue) return;
    if (manualValid) {
      onSelect(manualIdNum);
    } else {
      onSelect(effectiveSelection === "NONE" ? null : (effectiveSelection as number));
    }
  }

  return (
    <div className="space-y-4 font-mono text-[oklch(0.88_0.05_80)]">
      <div className="border border-[oklch(0.25_0.03_240)] bg-[oklch(0.07_0.01_240)] p-3">
        <p className="text-[oklch(0.55_0.06_80)] text-xs tracking-widest uppercase mb-3">Choose a Starting Lair</p>

        {isLoading ? (
          <p className="text-[oklch(0.45_0.03_80)] text-xs">Loading lairs...</p>
        ) : (
          <div className="space-y-1.5">
            {/* No preference option */}
            <button
              type="button"
              onClick={() => setSelected("NONE")}
              className={[
                "w-full text-left border px-3 py-2 text-xs transition-colors",
                selected === "NONE" && !manualValid
                  ? "border-[oklch(0.65_0.14_80)] bg-[oklch(0.12_0.03_80)] text-[oklch(0.88_0.1_80)]"
                  : "border-[oklch(0.22_0.03_240)] text-[oklch(0.6_0.04_80)] hover:border-[oklch(0.4_0.08_80)]",
              ].join(" ")}
            >
              <span className="text-[oklch(0.55_0.08_160)]">[~]</span>
              <span className="ml-2">No preference — spawn at world edge</span>
            </button>

            {/* Random lair cards */}
            {(lairs ?? []).map((lair: LairOption) => (
              <button
                key={lair.instanceId}
                type="button"
                onClick={() => setSelected(lair.instanceId)}
                className={[
                  "w-full text-left border px-3 py-2 text-xs transition-colors",
                  selected === lair.instanceId && !manualValid
                    ? "border-[oklch(0.65_0.14_80)] bg-[oklch(0.12_0.03_80)] text-[oklch(0.88_0.1_80)]"
                    : "border-[oklch(0.22_0.03_240)] text-[oklch(0.6_0.04_80)] hover:border-[oklch(0.4_0.08_80)]",
                ].join(" ")}
              >
                <span className="text-[oklch(0.65_0.14_80)]">[D]</span>
                <span className="ml-2 font-bold">{lair.godName}</span>
                <span className="ml-2 text-[oklch(0.55_0.06_80)]">
                  Favor: {lair.godFavor}
                </span>
                <span className="ml-2 text-[oklch(0.4_0.03_80)]">
                  @ ({lair.entranceGridX}, {lair.entranceGridY})
                </span>
                <span className="ml-2 text-[oklch(0.35_0.02_240)] text-xs">
                  #{lair.instanceId}
                </span>
              </button>
            ))}

            {lairs?.length === 0 && (
              <p className="text-[oklch(0.45_0.03_80)] text-xs italic px-1">
                No active lairs found. Frog will spawn at the world edge.
              </p>
            )}
          </div>
        )}

        {/* Manual lair ID */}
        <div className="mt-3 pt-3 border-t border-[oklch(0.18_0.02_240)]">
          <label className="block text-[oklch(0.45_0.03_80)] text-xs mb-1">
            — or enter lair ID manually —
          </label>
          <input
            type="number"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="Lair instance ID"
            min={1}
            className={[
              "w-full bg-transparent border px-3 py-1.5 text-sm focus:outline-none",
              manualValid
                ? "border-[oklch(0.55_0.12_80)] text-[oklch(0.88_0.05_80)]"
                : "border-[oklch(0.22_0.03_240)] text-[oklch(0.88_0.05_80)] placeholder-[oklch(0.35_0.02_240)]",
            ].join(" ")}
          />
          {manualValid && (
            <p className="text-[oklch(0.65_0.14_80)] text-xs mt-1">Using lair #{manualIdNum}</p>
          )}
        </div>
      </div>

      <button
        type="button"
        disabled={!canContinue}
        onClick={handleContinue}
        className={[
          "w-full py-2.5 border text-xs tracking-widest uppercase transition-colors",
          canContinue
            ? "border-[oklch(0.65_0.14_80)] text-[oklch(0.78_0.14_80)] hover:bg-[oklch(0.12_0.04_80)] cursor-pointer"
            : "border-[oklch(0.22_0.03_240)] text-[oklch(0.35_0.02_240)] cursor-not-allowed",
        ].join(" ")}
      >
        [ Continue → ]
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// REUSABLE PANEL
// ─────────────────────────────────────────────

interface FrogCreationPanelProps {
  onSubmit:    (data: CreateFrogInput) => void;
  isPending:   boolean;
  error?:      string | null;
  submitLabel?: string;
}

export function FrogCreationPanel({
  onSubmit,
  isPending,
  error,
  submitLabel = "[ Enter the Bog ]",
}: FrogCreationPanelProps) {
  const [step, setStep]             = useState<"SELECT_LAIR" | "CREATE_FROG">("SELECT_LAIR");
  const [lairInstanceId, setLairId] = useState<number | null>(null);
  const [name, setName]             = useState("");
  const [species, setSpecies]       = useState<FrogSpecies>("POISON_DART_FROG");
  const [stats, setStats]           = useState<FrogStatsDistribution>({ ...DEFAULT_STATS });

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
    onSubmit({ name: name.trim(), species, distributedStats: stats, lairInstanceId });
  }

  // Lair selection step
  if (step === "SELECT_LAIR") {
    return (
      <LairSelectionStep
        onSelect={(id) => {
          setLairId(id);
          setStep("CREATE_FROG");
        }}
      />
    );
  }

  const selectedDef = SPECIES_DEFS[species];

  return (
    <form onSubmit={handleSubmit} className="space-y-4 font-mono text-[oklch(0.88_0.05_80)]">

      {/* ── Selected lair indicator ── */}
      <div className="border border-[oklch(0.18_0.02_240)] bg-[oklch(0.06_0.01_240)] px-3 py-2 flex items-center justify-between">
        <span className="text-[oklch(0.45_0.03_80)] text-xs">
          Lair: {lairInstanceId != null ? `#${lairInstanceId}` : "world edge"}
        </span>
        <button
          type="button"
          onClick={() => setStep("SELECT_LAIR")}
          className="text-[oklch(0.45_0.06_80)] text-xs hover:text-[oklch(0.65_0.1_80)] transition-colors"
        >
          [change]
        </button>
      </div>

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
            const sel      = species === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSpecies(key)}
                className={[
                  "border px-2 py-1.5 text-left transition-colors text-xs",
                  sel
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
// HATCHING SCREEN
// ─────────────────────────────────────────────

interface HatchingScreenProps {
  onNavigate: () => void;
  onError:    (msg: string) => void;
}

function HatchingScreen({ onNavigate, onError }: HatchingScreenProps) {
  const myFrog    = trpc.frog.myFrog.useQuery(undefined, { refetchInterval: false });
  const resolvedRef = useRef(false);

  // Redirect as soon as myFrog appears
  useEffect(() => {
    if (myFrog.data && !resolvedRef.current) {
      resolvedRef.current = true;
      onNavigate();
    }
  }, [myFrog.data, onNavigate]);

  // WebSocket: ENGINE_TICK triggers refetch; SUBTICK_LOGS surfaces CREATE_FROG errors
  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ type: "IDENTIFY", role: "spectator" }));
    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; logs?: ActionLogEntry[] };
        if (msg.type === "ENGINE_TICK") {
          void myFrog.refetch().then((r) => {
            if (r.data && !resolvedRef.current) {
              resolvedRef.current = true;
              onNavigate();
            }
          });
        }
        if (msg.type === "SUBTICK_LOGS" && msg.logs) {
          const failed = msg.logs.find((l) => l.text.startsWith("CREATE_FROG failed:"));
          if (failed && !resolvedRef.current) {
            resolvedRef.current = true;
            onError(failed.text.replace("CREATE_FROG failed: ", ""));
          }
        }
      } catch {
        /* ignore malformed */
      }
    };
    ws.onerror = () => ws.close();

    // 60s safety timeout
    const timeout = setTimeout(() => {
      if (!resolvedRef.current) {
        resolvedRef.current = true;
        onError("Hatching timed out — please try again");
      }
    }, 60_000);

    return () => {
      ws.close();
      clearTimeout(timeout);
    };
  }, [myFrog, onNavigate, onError]);

  return (
    <div className="text-center space-y-6 font-mono">
      <p className="text-[oklch(0.55_0.04_80)] text-xs tracking-widest">═══════════════════════════════</p>
      <div>
        <p className="text-[oklch(0.65_0.14_80)] text-3xl tracking-widest animate-pulse">🥚</p>
        <p className="text-[oklch(0.78_0.14_80)] text-xl tracking-widest uppercase mt-3">Hatching...</p>
        <p className="text-[oklch(0.45_0.03_80)] text-xs mt-2 italic">
          Your frog is emerging from the egg. Awaiting the next heartbeat.
        </p>
      </div>
      <p className="text-[oklch(0.55_0.04_80)] text-xs tracking-widest">═══════════════════════════════</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// STANDALONE PAGE
// ─────────────────────────────────────────────

export default function FrogCreationFormPage() {
  const [, setLocation] = useLocation();
  const [error, setError]     = useState<string | null>(null);
  const [hatching, setHatching] = useState(false);

  const createFrog = trpc.frog.create.useMutation({
    onSuccess: () => setHatching(true),
    onError:   (e) => setError(e.message),
  });

  if (hatching) {
    return (
      <div className="min-h-screen bg-black text-[oklch(0.88_0.05_80)] font-mono flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          <HatchingScreen
            onNavigate={() => setLocation("/game")}
            onError={(msg) => {
              setHatching(false);
              setError(msg);
            }}
          />
        </div>
      </div>
    );
  }

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
