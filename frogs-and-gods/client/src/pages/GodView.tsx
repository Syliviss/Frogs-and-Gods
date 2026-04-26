import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { StatBar } from "@/components/StatBar";
import { trpc } from "@/lib/trpc";
import { useWorldLog } from "@/hooks/useWorldLog";
import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { getLoginUrl } from "@/const";
import type { WorldLogPayload } from "../../../shared/game.schema";

const INTERVENTION_COST = 20;

export default function GodView() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const [selectedEncounterId, setSelectedEncounterId] = useState<number | null>(null);
  const [selectedFrogId, setSelectedFrogId] = useState<number | null>(null);
  const [selectedFrogName, setSelectedFrogName] = useState<string>("");
  const logEndRef = useRef<HTMLDivElement>(null);

  const meQuery = trpc.auth.me.useQuery(undefined, { enabled: isAuthenticated });
  const god = meQuery.data?.god;

  const { entries, connected } = useWorldLog({
    role: "god",
    userId: user?.id,
    godId: god?.id,
    maxEntries: 150,
  });

  const activeEncounters = trpc.combat.activeEncounters.useQuery(undefined, {
    refetchInterval: 5000,
    enabled: isAuthenticated,
  });

  const intervene = trpc.god.intervene.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      meQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  // Auto-scroll log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-primary animate-pulse" style={{ fontFamily: "Cinzel, serif" }}>
          Ascending…
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">You must be logged in to access the God's View.</p>
          <Button onClick={() => (window.location.href = getLoginUrl())}>Login</Button>
        </div>
      </div>
    );
  }

  if (!god) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">You don't have a God profile yet.</p>
          <Button onClick={() => navigate("/")}>Ascend as a God</Button>
        </div>
      </div>
    );
  }

  const canIntervene = god.divinePower >= INTERVENTION_COST;

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        background:
          "radial-gradient(ellipse at 100% 0%, oklch(0.18 0.08 290 / 0.25) 0%, transparent 50%), oklch(0.10 0.015 240)",
      }}
    >
      {/* ── TOPBAR ── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>←</span>
          <span className="text-sm">Realm</span>
        </button>
        <span style={{ fontFamily: "Cinzel, serif", color: "var(--divine-color)", fontSize: "0.95rem" }}>
          ⚡ God's View
        </span>
        <div className="flex items-center gap-2 text-xs">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
          <span className="text-muted-foreground">{connected ? "Live" : "Reconnecting…"}</span>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 max-w-6xl mx-auto w-full">
        {/* ── LEFT: GOD PROFILE + INTERVENTIONS ── */}
        <div className="space-y-4">
          {/* God Profile */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4" style={{ borderColor: "oklch(0.78 0.16 80 / 0.3)" }}>
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-2xl border"
                style={{ background: "oklch(0.18 0.06 80 / 0.5)", borderColor: "var(--divine-color)" }}
              >
                ⚡
              </div>
              <div>
                <h2 className="font-semibold" style={{ fontFamily: "Cinzel, serif", color: "var(--divine-color)" }}>
                  {god.name}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {god.totalInterventions} intervention{god.totalInterventions !== 1 ? "s" : ""} cast
                </p>
              </div>
            </div>

            <StatBar value={god.divinePower} max={200} type="divine" label="Divine Power" />

            <p className="text-xs text-muted-foreground text-center">
              Each intervention costs {INTERVENTION_COST} divine power
            </p>
          </div>

          {/* Active Encounters */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold" style={{ fontFamily: "Cinzel, serif", color: "var(--mp-color)" }}>
              Active Encounters
            </h3>
            {activeEncounters.data && activeEncounters.data.length > 0 ? (
              <div className="space-y-2">
                {activeEncounters.data.map((enc) => {
                  const enemy = JSON.parse(enc.enemyData);
                  return (
                    <button
                      key={enc.id}
                      onClick={() => {
                        setSelectedEncounterId(enc.id);
                        if (enc.frogId) setSelectedFrogId(enc.frogId);
                      }}
                      className={`w-full text-left p-3 rounded-lg border text-sm transition-all ${
                        selectedEncounterId === enc.id
                          ? "border-primary bg-primary/10"
                          : "border-border bg-muted/20 hover:border-primary/40"
                      }`}
                    >
                      <div className="font-semibold text-foreground">Encounter #{enc.id}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        vs {enemy.name} — Turn {enc.currentTurn}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No active encounters.</p>
            )}
          </div>

          {/* Intervention Panel */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold" style={{ fontFamily: "Cinzel, serif", color: "var(--divine-color)" }}>
              Divine Interventions
            </h3>

            {!selectedEncounterId ? (
              <p className="text-xs text-muted-foreground italic">Select an encounter to intervene.</p>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Encounter #{selectedEncounterId}
                </p>

                {/* HEAL FROG */}
                <InterventionButton
                  emoji="💚"
                  label="Heal Frog"
                  description="Restore 37 HP to the targeted Frog"
                  color="var(--xp-color)"
                  disabled={!canIntervene || intervene.isPending}
                  cost={INTERVENTION_COST}
                  onClick={() => {
                    if (!selectedEncounterId) return;
                    intervene.mutate({
                      encounterId: selectedEncounterId,
                      interventionType: "HEAL_FROG",
                      targetFrogId: selectedFrogId ?? undefined,
                      magnitude: 25,
                    });
                  }}
                />

                {/* SMITE ENEMY */}
                <InterventionButton
                  emoji="⚡"
                  label="Smite Enemy"
                  description="Strike the enemy for 62 divine damage"
                  color="var(--divine-color)"
                  disabled={!canIntervene || intervene.isPending}
                  cost={INTERVENTION_COST}
                  onClick={() => {
                    if (!selectedEncounterId) return;
                    intervene.mutate({
                      encounterId: selectedEncounterId,
                      interventionType: "SMITE_ENEMY",
                      magnitude: 25,
                    });
                  }}
                />

                {!canIntervene && (
                  <p className="text-xs text-destructive text-center">
                    Insufficient divine power.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: WORLD LOG ── */}
        <div className="md:col-span-2 flex flex-col rounded-xl border border-border bg-card overflow-hidden" style={{ minHeight: "600px" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
            <h3 className="font-semibold" style={{ fontFamily: "Cinzel, serif", color: "var(--divine-color)" }}>
              The World Log
            </h3>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{entries.length} events</span>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full animate-pulse ${connected ? "bg-green-500" : "bg-red-500"}`} />
                <span className="text-xs text-muted-foreground">{connected ? "Streaming" : "Disconnected"}</span>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 px-4 py-2 border-b border-border/30 bg-muted/10">
            {[
              { type: "COMBAT_TURN", label: "Combat", color: "var(--hp-color)" },
              { type: "HEAL_FROG", label: "Heal", color: "var(--xp-color)" },
              { type: "SMITE_ENEMY", label: "Smite", color: "var(--divine-color)" },
              { type: "ENCOUNTER_START", label: "Encounter", color: "var(--mp-color)" },
            ].map(({ label, color }) => (
              <div key={label} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
              </div>
            ))}
          </div>

          {/* Log entries */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-3 py-16">
                <div className="text-4xl opacity-30">👁️</div>
                <p className="text-muted-foreground text-sm italic">
                  The World Log awaits the first battle…
                </p>
                <p className="text-xs text-muted-foreground">
                  Events will appear here in real time as Frogs fight.
                </p>
              </div>
            ) : (
              <>
                {[...entries].reverse().map((entry, i) => (
                  <WorldLogEntry
                    key={i}
                    entry={entry}
                    onSelectFrog={(frogId, frogName, encounterId) => {
                      setSelectedFrogId(frogId);
                      setSelectedFrogName(frogName);
                      setSelectedEncounterId(encounterId);
                    }}
                  />
                ))}
                <div ref={logEndRef} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────

function WorldLogEntry({
  entry,
  onSelectFrog,
}: {
  entry: WorldLogPayload;
  onSelectFrog?: (frogId: number, frogName: string, encounterId: number) => void;
}) {
  const timeStr = new Date(entry.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const eventEmoji: Record<string, string> = {
    COMBAT_TURN: "⚔️",
    HEAL_FROG: "💚",
    SMITE_ENEMY: "⚡",
    ENCOUNTER_START: "🌿",
    VICTORY: "🏆",
    DEFEAT: "💀",
  };

  return (
    <div
      className={`world-log-entry ${entry.eventType} flex items-start gap-2 group`}
      onClick={() => {
        if (entry.frogId && entry.frogName && entry.encounterId && onSelectFrog) {
          onSelectFrog(entry.frogId, entry.frogName, entry.encounterId);
        }
      }}
      style={{ cursor: entry.frogId ? "pointer" : "default" }}
    >
      <span className="text-sm mt-0.5 shrink-0">{eventEmoji[entry.eventType] ?? "📜"}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground/90 leading-snug">{entry.message}</p>
        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
          <span
            className="text-[10px] text-muted-foreground"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {timeStr}
          </span>
          {entry.damage !== undefined && (
            <span className="text-[10px]" style={{ color: "var(--hp-color)" }}>
              -{entry.damage} HP
            </span>
          )}
          {entry.heal !== undefined && (
            <span className="text-[10px]" style={{ color: "var(--xp-color)" }}>
              +{entry.heal} HP
            </span>
          )}
          {entry.xpGained !== undefined && (
            <span className="text-[10px]" style={{ color: "var(--xp-color)" }}>
              +{entry.xpGained} XP
            </span>
          )}
          {entry.lootDropped && (
            <span className="text-[10px]" style={{ color: "var(--divine-color)" }}>
              🎁 {entry.lootDropped}
            </span>
          )}
          {entry.frogName && (
            <span className="text-[10px] text-muted-foreground group-hover:text-primary transition-colors">
              🐸 {entry.frogName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function InterventionButton({
  emoji,
  label,
  description,
  color,
  disabled,
  cost,
  onClick,
}: {
  emoji: string;
  label: string;
  description: string;
  color: string;
  disabled: boolean;
  cost: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all duration-200"
      style={{
        borderColor: disabled ? "var(--border)" : `${color}50`,
        background: disabled ? "var(--muted)" : `oklch(from ${color} l c h / 0.08)`,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "none" : `0 0 12px ${color}20`,
      }}
    >
      <span className="text-2xl">{emoji}</span>
      <div className="flex-1">
        <div className="text-sm font-semibold" style={{ fontFamily: "Cinzel, serif", color }}>
          {label}
        </div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <div className="text-xs text-muted-foreground shrink-0">
        -{cost} DP
      </div>
    </button>
  );
}
