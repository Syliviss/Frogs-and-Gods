import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

const AI_COLORS: Record<string, string> = {
  HUNTER:   "#f87171",
  REACTIVE: "#fb923c",
  DOCILE:   "#4ade80",
};

const ENEMY_GLYPHS: Record<string, string> = {
  SNAKE: "S",
  FLY:   "F",
};

export function EnemiesTab() {
  const [gridX, setGridX]         = useState("0");
  const [gridY, setGridY]         = useState("0");
  const [enemyType, setEnemyType] = useState<"SNAKE" | "FLY">("SNAKE");
  const [aiType, setAiType]       = useState<"HUNTER" | "REACTIVE" | "DOCILE">("HUNTER");
  const [speed, setSpeed]         = useState("5");
  const [hp, setHp]               = useState("20");
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [pendingKills, setPendingKills] = useState<Set<number>>(new Set());

  const { data: enemies, refetch } = trpc.admin.getEnemies.useQuery(undefined, {
    refetchInterval: 10_000,
  });

  const spawnMutation = trpc.admin.triggerSpawn.useMutation({
    onSuccess: (data) => {
      setLastResult(`Queued SPAWN_PREDATOR — action #${data.pendingActionId}. Resolves next heartbeat.`);
      void refetch();
    },
    onError: (err) => {
      setLastResult(`Error: ${err.message}`);
    },
  });

  const killMutation = trpc.admin.triggerKill.useMutation({
    onSuccess: (data, vars) => {
      setPendingKills((prev) => { const s = new Set(prev); s.delete(vars.predatorId); return s; });
      setLastResult(`Queued KILL_PREDATOR #${vars.predatorId} — resolves next heartbeat.`);
      void refetch();
    },
    onError: (err, vars) => {
      setPendingKills((prev) => { const s = new Set(prev); s.delete(vars.predatorId); return s; });
      setLastResult(`Error: ${err.message}`);
    },
  });

  function handleSpawn() {
    const x = parseInt(gridX, 10);
    const y = parseInt(gridY, 10);
    const s = parseInt(speed, 10);
    const h = parseInt(hp, 10);
    if (isNaN(x) || isNaN(y) || isNaN(s) || isNaN(h)) {
      setLastResult("All fields must be valid integers.");
      return;
    }
    spawnMutation.mutate({ gridX: x, gridY: y, enemyType, aiType, speed: s, hp: h });
  }

  function handleKill(predatorId: number) {
    setPendingKills((prev) => new Set(prev).add(predatorId));
    killMutation.mutate({ predatorId });
  }

  return (
    <div className="space-y-6 p-4">
      <h2 className="text-lg font-bold text-white">Enemy Management</h2>

      {/* ── Spawn Form ─────────────────────── */}
      <div className="rounded border border-zinc-700 bg-zinc-900 p-4 space-y-4">
        <h3 className="text-sm font-semibold text-zinc-300">Spawn Predator</h3>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">Grid X</Label>
            <Input
              type="number"
              value={gridX}
              onChange={(e) => setGridX(e.target.value)}
              className="h-8 bg-zinc-800 border-zinc-600 text-white text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">Grid Y</Label>
            <Input
              type="number"
              value={gridY}
              onChange={(e) => setGridY(e.target.value)}
              className="h-8 bg-zinc-800 border-zinc-600 text-white text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">Enemy Type</Label>
            <select
              value={enemyType}
              onChange={(e) => setEnemyType(e.target.value as "SNAKE" | "FLY")}
              className="w-full h-8 rounded bg-zinc-800 border border-zinc-600 text-white text-sm px-2"
            >
              <option value="SNAKE">SNAKE</option>
              <option value="FLY">FLY</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">AI Type</Label>
            <select
              value={aiType}
              onChange={(e) => setAiType(e.target.value as "HUNTER" | "REACTIVE" | "DOCILE")}
              className="w-full h-8 rounded bg-zinc-800 border border-zinc-600 text-white text-sm px-2"
            >
              <option value="HUNTER">HUNTER</option>
              <option value="REACTIVE">REACTIVE</option>
              <option value="DOCILE">DOCILE</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">Speed (1–10)</Label>
            <Input
              type="number"
              min={1}
              max={10}
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              className="h-8 bg-zinc-800 border-zinc-600 text-white text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-zinc-400">HP (1–100)</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={hp}
              onChange={(e) => setHp(e.target.value)}
              className="h-8 bg-zinc-800 border-zinc-600 text-white text-sm"
            />
          </div>
        </div>

        <Button
          onClick={handleSpawn}
          disabled={spawnMutation.isPending}
          className="w-full bg-red-700 hover:bg-red-600 text-white text-sm"
        >
          {spawnMutation.isPending ? "Queuing…" : "Spawn Enemy"}
        </Button>

        {lastResult && (
          <p className="text-xs text-zinc-400 font-mono">{lastResult}</p>
        )}
      </div>

      {/* ── Enemy List ─────────────────────── */}
      <div className="rounded border border-zinc-700 bg-zinc-900 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-300">
            Active Predators{" "}
            <span className="text-zinc-500 font-normal">
              ({enemies?.length ?? 0} / 100 cap)
            </span>
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refetch()}
            className="text-xs text-zinc-400 hover:text-white h-6 px-2"
          >
            Refresh
          </Button>
        </div>

        <ScrollArea className="h-72">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-zinc-500 text-left border-b border-zinc-800">
                <th className="pb-1 pr-2">ID</th>
                <th className="pb-1 pr-2">Glyph</th>
                <th className="pb-1 pr-2">Type</th>
                <th className="pb-1 pr-2">AI</th>
                <th className="pb-1 pr-2">X</th>
                <th className="pb-1 pr-2">Y</th>
                <th className="pb-1 pr-2">HP</th>
                <th className="pb-1 pr-2">Spd</th>
                <th className="pb-1"></th>
              </tr>
            </thead>
            <tbody>
              {enemies?.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-zinc-600">
                    No predators in the world.
                  </td>
                </tr>
              )}
              {enemies?.map((enemy) => {
                const stats = enemy.statsJson as { speed?: number } | null;
                const isPending = pendingKills.has(enemy.id);
                return (
                  <tr key={enemy.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="py-1 pr-2 text-zinc-500">{enemy.id}</td>
                    <td className="py-1 pr-2 text-red-400 font-bold">
                      {ENEMY_GLYPHS[enemy.enemyType] ?? "?"}
                    </td>
                    <td className="py-1 pr-2 text-red-300">{enemy.enemyType}</td>
                    <td className="py-1 pr-2" style={{ color: AI_COLORS[enemy.aiType] ?? "#9ca3af" }}>
                      {enemy.aiType}
                    </td>
                    <td className="py-1 pr-2 text-zinc-300">{enemy.gridX}</td>
                    <td className="py-1 pr-2 text-zinc-300">{enemy.gridY}</td>
                    <td className="py-1 pr-2 text-green-400">{enemy.currentHp}</td>
                    <td className="py-1 pr-2 text-zinc-400">{stats?.speed ?? 5}</td>
                    <td className="py-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isPending}
                        onClick={() => handleKill(enemy.id)}
                        className="h-5 px-2 text-xs text-red-400 hover:text-red-200 hover:bg-red-900/30"
                      >
                        {isPending ? "…" : "Smite"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollArea>
      </div>
    </div>
  );
}
