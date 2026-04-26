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

type MoveType = "ATTACK" | "MAGIC" | "DEFEND" | "FLEE";

const MOVE_CONFIG: Record<MoveType, { label: string; emoji: string; desc: string; mpCost?: number }> = {
  ATTACK: { label: "Attack", emoji: "⚔️", desc: "Strike the enemy with physical force" },
  MAGIC:  { label: "Magic",  emoji: "✨", desc: "Cast a spell (costs 15 MP)", mpCost: 15 },
  DEFEND: { label: "Defend", emoji: "🛡️", desc: "Brace for impact, reduce damage taken" },
  FLEE:   { label: "Flee",   emoji: "💨", desc: "Attempt to escape the encounter" },
};

export default function FrogDashboard() {
  const { user, isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();
  const [selectedMove, setSelectedMove] = useState<MoveType>("ATTACK");
  const [activeEncounterId, setActiveEncounterId] = useState<number | null>(null);
  const [combatLog, setCombatLog] = useState<string[]>([]);
  const [partyName, setPartyName] = useState("");
  const [showPartyCreate, setShowPartyCreate] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const meQuery = trpc.auth.me.useQuery(undefined, { enabled: isAuthenticated });
  const frog = meQuery.data?.frog;

  const { entries: worldLogEntries, connected: wsConnected } = useWorldLog({
    role: "frog",
    userId: user?.id,
  });

  const startEncounter = trpc.combat.startEncounter.useMutation({
    onSuccess: (data) => {
      setActiveEncounterId(data.encounter.id);
      setCombatLog([`⚔️ A wild ${data.enemy.name} appears! HP: ${data.enemy.hp}`]);
      toast.success(`Encounter started against ${data.enemy.name}!`);
    },
    onError: (e) => toast.error(e.message),
  });

  const submitMove = trpc.combat.submitMove.useMutation({
    onSuccess: (data) => {
      const { turnResult } = data;
      setCombatLog((prev) => [...prev, ...turnResult.log]);
      if (turnResult.encounterStatus !== "active") {
        setActiveEncounterId(null);
        if (turnResult.encounterStatus === "victory") {
          toast.success("Victory! The enemy has been slain.");
        } else if (turnResult.encounterStatus === "defeat") {
          toast.error("You have fallen in battle. Permadeath claimed you.");
        } else if (turnResult.encounterStatus === "fled") {
          toast("You fled the battle.");
        }
        meQuery.refetch();
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const createParty = trpc.party.create.useMutation({
    onSuccess: () => {
      toast.success("Party created!");
      setShowPartyCreate(false);
      setPartyName("");
      meQuery.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const partyQuery = trpc.party.myParty.useQuery(undefined, { enabled: isAuthenticated && !!frog });

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [combatLog]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-primary animate-pulse" style={{ fontFamily: "Cinzel, serif" }}>
          Loading…
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">You must be logged in to access the Frog Dashboard.</p>
          <Button onClick={() => (window.location.href = getLoginUrl())}>Login</Button>
        </div>
      </div>
    );
  }

  if (!frog) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">You don't have a Frog character yet.</p>
          <Button onClick={() => navigate("/")}>Create a Frog</Button>
        </div>
      </div>
    );
  }

  if (frog.isDead) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "oklch(0.05 0.02 25 / 0.95)" }}>
        <div className="text-center space-y-6 max-w-md px-6">
          <div className="text-6xl">💀</div>
          <h1 className="text-3xl font-bold" style={{ fontFamily: "Cinzel, serif", color: "var(--hp-color)" }}>
            You Have Fallen
          </h1>
          <p className="text-muted-foreground italic">
            "{frog.name} fought bravely, but the swamp eternal claimed their soul."
          </p>
          <p className="text-sm text-muted-foreground">
            Permadeath is permanent. Your legend lives on in the World Log.
          </p>
          <Button variant="outline" onClick={() => navigate("/")}>Return to the Realm</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "radial-gradient(ellipse at 0% 100%, oklch(0.12 0.04 140 / 0.2) 0%, transparent 50%), oklch(0.10 0.015 240)" }}>
      {/* ── TOPBAR ── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <button onClick={() => navigate("/")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
          <span>←</span>
          <span className="text-sm">Realm</span>
        </button>
        <span style={{ fontFamily: "Cinzel, serif", color: "var(--primary)", fontSize: "0.95rem" }}>
          🐸 Frog Dashboard
        </span>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`w-2 h-2 rounded-full ${wsConnected ? "bg-green-500" : "bg-red-500"}`} />
          <span>{wsConnected ? "Live" : "Offline"}</span>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 max-w-6xl mx-auto w-full">
        {/* ── LEFT: CHARACTER STATS ── */}
        <div className="space-y-4">
          {/* Character Card */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-2xl border border-border" style={{ background: "oklch(0.15 0.03 140 / 0.5)" }}>
                🐸
              </div>
              <div>
                <h2 className="font-semibold" style={{ fontFamily: "Cinzel, serif", color: "var(--primary)" }}>
                  {frog.name}
                </h2>
                <p className="text-xs text-muted-foreground">Level {frog.level} Frog</p>
              </div>
            </div>

            <div className="space-y-3">
              <StatBar value={frog.hp} max={frog.maxHp} type="hp" />
              <StatBar value={frog.mp} max={frog.maxMp} type="mp" />
              <StatBar value={frog.xp} max={frog.xpToNextLevel} type="xp" label="XP to Next Level" />
            </div>

            <div className="ornament-divider">
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Stats</span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              {[
                { label: "Attack", value: frog.attack, emoji: "⚔️" },
                { label: "Defense", value: frog.defense, emoji: "🛡️" },
                { label: "Speed", value: frog.speed, emoji: "💨" },
                { label: "Level", value: frog.level, emoji: "⭐" },
              ].map(({ label, value, emoji }) => (
                <div key={label} className="flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-muted/30">
                  <span className="text-base">{emoji}</span>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
                    <div className="font-semibold text-foreground" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Party Panel */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <h3 className="text-sm font-semibold" style={{ fontFamily: "Cinzel, serif", color: "var(--mp-color)" }}>
              Party
            </h3>
            {partyQuery.data ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Party #{partyQuery.data.partyId}</p>
                {partyQuery.data.members.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 text-sm">
                    <span>{m.isDead ? "💀" : "🐸"}</span>
                    <span className={m.isDead ? "line-through text-muted-foreground" : ""}>{m.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">Lv.{m.level}</span>
                  </div>
                ))}
              </div>
            ) : showPartyCreate ? (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Party name…"
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm rounded border border-border bg-input text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => setShowPartyCreate(false)}>Cancel</Button>
                  <Button size="sm" className="flex-1 text-xs" disabled={partyName.trim().length < 2} onClick={() => createParty.mutate({ name: partyName.trim() })}>
                    Create
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">You are not in a party.</p>
                <Button size="sm" variant="outline" className="w-full text-xs" onClick={() => setShowPartyCreate(true)}>
                  + Create Party
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* ── CENTER: COMBAT ── */}
        <div className="md:col-span-2 space-y-4">
          {/* Combat Log */}
          <div className="rounded-xl border border-border bg-card flex flex-col" style={{ height: "340px" }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
              <h3 className="text-sm font-semibold" style={{ fontFamily: "Cinzel, serif", color: "var(--foreground)" }}>
                Combat Log
              </h3>
              {activeEncounterId && (
                <span className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: "var(--hp-color)", color: "var(--hp-color)" }}>
                  In Battle
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {combatLog.length === 0 ? (
                <p className="text-muted-foreground text-sm italic text-center mt-8">
                  The swamp is quiet… for now.
                </p>
              ) : (
                combatLog.map((line, i) => (
                  <div key={i} className="text-sm text-foreground/90 py-0.5 border-l-2 border-border/30 pl-2">
                    {line}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>

          {/* Action Panel */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <h3 className="text-sm font-semibold" style={{ fontFamily: "Cinzel, serif" }}>
              Actions
            </h3>

            {!activeEncounterId ? (
              <div className="text-center py-4 space-y-3">
                <p className="text-muted-foreground text-sm">No active encounter.</p>
                <Button
                  onClick={() => startEncounter.mutate({})}
                  disabled={startEncounter.isPending}
                  className="glow-gold"
                >
                  {startEncounter.isPending ? "Entering battle…" : "⚔️ Start Encounter"}
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Move selector */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(Object.keys(MOVE_CONFIG) as MoveType[]).map((move) => {
                    const cfg = MOVE_CONFIG[move];
                    const disabled = move === "MAGIC" && frog.mp < (cfg.mpCost ?? 0);
                    return (
                      <button
                        key={move}
                        onClick={() => !disabled && setSelectedMove(move)}
                        disabled={disabled}
                        className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-center transition-all duration-200 ${
                          selectedMove === move
                            ? "border-primary bg-primary/10"
                            : "border-border bg-muted/20 hover:border-primary/50"
                        } ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                      >
                        <span className="text-xl">{cfg.emoji}</span>
                        <span className="text-xs font-semibold" style={{ fontFamily: "Cinzel, serif" }}>{cfg.label}</span>
                        <span className="text-[10px] text-muted-foreground leading-tight">{cfg.desc}</span>
                      </button>
                    );
                  })}
                </div>

                <Button
                  className="w-full"
                  onClick={() => {
                    if (!activeEncounterId || !frog) return;
                    submitMove.mutate({
                      encounterId: activeEncounterId,
                      frogId: frog.id,
                      moveType: selectedMove,
                    });
                  }}
                  disabled={submitMove.isPending}
                >
                  {submitMove.isPending ? "Processing turn…" : `Execute: ${MOVE_CONFIG[selectedMove].label}`}
                </Button>
              </div>
            )}
          </div>

          {/* World Log Feed (recent) */}
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ fontFamily: "Cinzel, serif", color: "var(--divine-color)" }}>
                World Log
              </h3>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Live</span>
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {worldLogEntries.length === 0 ? (
                <p className="text-muted-foreground text-xs italic">No events yet.</p>
              ) : (
                worldLogEntries.slice(0, 10).map((entry, i) => (
                  <WorldLogEntry key={i} entry={entry} />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorldLogEntry({ entry }: { entry: WorldLogPayload }) {
  const timeStr = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div className={`world-log-entry ${entry.eventType}`}>
      <span className="text-muted-foreground text-[10px] mr-2" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
        {timeStr}
      </span>
      <span className="text-foreground/90">{entry.message}</span>
    </div>
  );
}
