import { useState, useMemo } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useWorldLog } from "@/hooks/useWorldLog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Viewport } from "@/components/Viewport";

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const ENEMY_TEMPLATES = [
  { id: "swamp-toad",    name: "Swamp Toad"   },
  { id: "mud-golem",     name: "Mud Golem"    },
  { id: "bog-wraith",    name: "Bog Wraith"   },
  { id: "elder-serpent", name: "Elder Serpent" },
  { id: "void-herald",   name: "Void Herald"  },
];

const MOVE_TYPES = ["ATTACK", "MAGIC", "DEFEND", "FLEE"] as const;

const RARITY_COLORS: Record<string, string> = {
  "Common":             "#9ca3af",
  "Uncommon":           "#4ade80",
  "Rare":               "#60a5fa",
  "Epic":               "#c084fc",
  "Legendary":          "#fb923c",
  "Mythic":             "#f43f5e",
  "Celestial":          "#e0f2fe",
  "Abyssal":            "#7c3aed",
  "Divine":             "#fde68a",
  "Transcendent":       "#f0abfc",
  "Primordial":         "#fca5a5",
  "Mythic Transcendent": "#ff6b6b",
};

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: ok ? "#4ade80" : "#f87171",
        marginRight: 6,
      }}
    />
  );
}

// ─────────────────────────────────────────────
// USERS TAB
// ─────────────────────────────────────────────

function UsersTab() {
  const { data: users, refetch } = trpc.admin.listUsers.useQuery();
  const setRole = trpc.admin.setUserRole.useMutation({ onSuccess: () => refetch() });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ color: "#9ca3af", fontSize: 13 }}>
        {users?.length ?? 0} users registered
      </p>
      <ScrollArea style={{ height: 500 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1e2a3a", color: "#9ca3af", textAlign: "left" }}>
              <th style={{ padding: "6px 10px" }}>ID</th>
              <th style={{ padding: "6px 10px" }}>Name</th>
              <th style={{ padding: "6px 10px" }}>Email</th>
              <th style={{ padding: "6px 10px" }}>Role</th>
              <th style={{ padding: "6px 10px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id} style={{ borderBottom: "1px solid #0f1929" }}>
                <td style={{ padding: "6px 10px", color: "#6b7280" }}>{u.id}</td>
                <td style={{ padding: "6px 10px" }}>{u.name ?? "—"}</td>
                <td style={{ padding: "6px 10px", color: "#6b7280" }}>{u.email ?? "—"}</td>
                <td style={{ padding: "6px 10px" }}>
                  <Badge
                    variant="outline"
                    style={{
                      color: u.role === "admin" ? "#fde68a" : u.role === "god" ? "#c084fc" : "#4ade80",
                      borderColor: "currentColor",
                      fontSize: 11,
                    }}
                  >
                    {u.role}
                  </Badge>
                </td>
                <td style={{ padding: "6px 10px", display: "flex", gap: 6 }}>
                  {(["frog", "god", "admin"] as const).map((r) => (
                    <Button
                      key={r}
                      size="sm"
                      variant="outline"
                      disabled={u.role === r || setRole.isPending}
                      onClick={() => setRole.mutate({ userId: u.id, role: r })}
                      style={{ fontSize: 11, padding: "2px 8px", height: "auto" }}
                    >
                      {r}
                    </Button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

// ─────────────────────────────────────────────
// FROGS TAB
// ─────────────────────────────────────────────

function FrogsTab() {
  const { data: frogs, refetch } = trpc.admin.listFrogs.useQuery();
  const createFrog = trpc.admin.createTestFrog.useMutation({ onSuccess: () => refetch() });
  const grantXp = trpc.admin.grantXp.useMutation({ onSuccess: () => refetch() });
  const resurrect = trpc.admin.resurrectFrog.useMutation({ onSuccess: () => refetch() });

  const [newFrogName, setNewFrogName] = useState("");
  const [xpAmounts, setXpAmounts] = useState<Record<number, string>>({});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Label style={{ fontSize: 12, color: "#9ca3af" }}>Create Test Frog</Label>
          <Input
            placeholder="Character name"
            value={newFrogName}
            onChange={(e) => setNewFrogName(e.target.value)}
            style={{ width: 200, fontSize: 13 }}
          />
        </div>
        <Button
          size="sm"
          disabled={!newFrogName.trim() || createFrog.isPending}
          onClick={() => {
            createFrog.mutate({ name: newFrogName.trim() });
            setNewFrogName("");
          }}
        >
          Spawn Frog
        </Button>
      </div>

      <p style={{ color: "#9ca3af", fontSize: 13 }}>
        {frogs?.length ?? 0} frogs total — {frogs?.filter((f) => f.isDead).length ?? 0} dead
      </p>

      <ScrollArea style={{ height: 440 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1e2a3a", color: "#9ca3af", textAlign: "left" }}>
              <th style={{ padding: "6px 8px" }}>ID</th>
              <th style={{ padding: "6px 8px" }}>Name</th>
              <th style={{ padding: "6px 8px" }}>Lvl</th>
              <th style={{ padding: "6px 8px" }}>XP</th>
              <th style={{ padding: "6px 8px" }}>HP</th>
              <th style={{ padding: "6px 8px" }}>MP</th>
              <th style={{ padding: "6px 8px" }}>ATK</th>
              <th style={{ padding: "6px 8px" }}>DEF</th>
              <th style={{ padding: "6px 8px" }}>Status</th>
              <th style={{ padding: "6px 8px" }}>Grant XP</th>
              <th style={{ padding: "6px 8px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {frogs?.map((f) => (
              <tr
                key={f.id}
                style={{
                  borderBottom: "1px solid #0f1929",
                  opacity: f.isDead ? 0.5 : 1,
                }}
              >
                <td style={{ padding: "6px 8px", color: "#6b7280" }}>{f.id}</td>
                <td style={{ padding: "6px 8px" }}>{f.name}</td>
                <td style={{ padding: "6px 8px", color: "#60a5fa" }}>{f.level}</td>
                <td style={{ padding: "6px 8px", color: "#9ca3af" }}>{f.xp}/{f.xpToNextLevel}</td>
                <td style={{ padding: "6px 8px", color: "#4ade80" }}>{f.hp}/{f.maxHp}</td>
                <td style={{ padding: "6px 8px", color: "#818cf8" }}>{f.mp}/{f.maxMp}</td>
                <td style={{ padding: "6px 8px" }}>{f.attack}</td>
                <td style={{ padding: "6px 8px" }}>{f.defense}</td>
                <td style={{ padding: "6px 8px" }}>
                  {f.isDead ? (
                    <Badge variant="destructive" style={{ fontSize: 10 }}>DEAD</Badge>
                  ) : (
                    <Badge variant="outline" style={{ fontSize: 10, color: "#4ade80", borderColor: "#4ade80" }}>ALIVE</Badge>
                  )}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <Input
                      type="number"
                      placeholder="XP"
                      value={xpAmounts[f.id] ?? ""}
                      onChange={(e) => setXpAmounts((prev) => ({ ...prev, [f.id]: e.target.value }))}
                      style={{ width: 70, fontSize: 12 }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!xpAmounts[f.id] || grantXp.isPending}
                      onClick={() => {
                        const amt = parseInt(xpAmounts[f.id] ?? "0");
                        if (amt > 0) {
                          grantXp.mutate({ frogId: f.id, amount: amt });
                          setXpAmounts((prev) => ({ ...prev, [f.id]: "" }));
                        }
                      }}
                      style={{ fontSize: 11, padding: "2px 6px", height: "auto" }}
                    >
                      +XP
                    </Button>
                  </div>
                </td>
                <td style={{ padding: "6px 8px" }}>
                  {f.isDead && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resurrect.isPending}
                      onClick={() => resurrect.mutate({ frogId: f.id })}
                      style={{ fontSize: 11, padding: "2px 8px", height: "auto", color: "#4ade80", borderColor: "#4ade80" }}
                    >
                      Resurrect
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

// ─────────────────────────────────────────────
// GODS TAB
// ─────────────────────────────────────────────

function GodsTab() {
  const { data: gods, refetch } = trpc.admin.listGods.useQuery();
  const setPower = trpc.admin.setDivinePower.useMutation({ onSuccess: () => refetch() });
  const [powerAmounts, setPowerAmounts] = useState<Record<number, string>>({});

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ color: "#9ca3af", fontSize: 13 }}>{gods?.length ?? 0} gods watching</p>
      <ScrollArea style={{ height: 480 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1e2a3a", color: "#9ca3af", textAlign: "left" }}>
              <th style={{ padding: "6px 10px" }}>ID</th>
              <th style={{ padding: "6px 10px" }}>Name</th>
              <th style={{ padding: "6px 10px" }}>Divine Power</th>
              <th style={{ padding: "6px 10px" }}>Interventions</th>
              <th style={{ padding: "6px 10px" }}>Set Power</th>
            </tr>
          </thead>
          <tbody>
            {gods?.map((g) => (
              <tr key={g.id} style={{ borderBottom: "1px solid #0f1929" }}>
                <td style={{ padding: "6px 10px", color: "#6b7280" }}>{g.id}</td>
                <td style={{ padding: "6px 10px", color: "#fde68a" }}>{g.name}</td>
                <td style={{ padding: "6px 10px", color: "#c084fc" }}>{g.divinePower}</td>
                <td style={{ padding: "6px 10px", color: "#9ca3af" }}>{g.totalInterventions}</td>
                <td style={{ padding: "6px 10px" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    <Input
                      type="number"
                      placeholder="Amount"
                      value={powerAmounts[g.id] ?? ""}
                      onChange={(e) => setPowerAmounts((prev) => ({ ...prev, [g.id]: e.target.value }))}
                      style={{ width: 80, fontSize: 12 }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!powerAmounts[g.id] || setPower.isPending}
                      onClick={() => {
                        const amt = parseInt(powerAmounts[g.id] ?? "0");
                        if (!isNaN(amt)) {
                          setPower.mutate({ godId: g.id, amount: amt });
                          setPowerAmounts((prev) => ({ ...prev, [g.id]: "" }));
                        }
                      }}
                      style={{ fontSize: 11, padding: "2px 6px", height: "auto" }}
                    >
                      Set
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

// ─────────────────────────────────────────────
// COMBAT TAB
// ─────────────────────────────────────────────

function CombatTab() {
  const { data: frogs } = trpc.admin.listFrogs.useQuery();
  const { data: activeEncounters, refetch: refetchEncounters } = trpc.combat.activeEncounters.useQuery();

  const startEncounter = trpc.admin.startEncounterAs.useMutation({
    onSuccess: (data) => {
      setCombatLog((prev) => [
        `[START] Frog #${data.encounter.frogId} vs ${data.enemy.name} (Encounter #${data.encounter.id})`,
        ...prev,
      ]);
      setActiveEncounterId(data.encounter.id);
      setActiveFrogId(data.encounter.frogId ?? null);
      refetchEncounters();
    },
  });

  const submitMove = trpc.admin.submitMoveAs.useMutation({
    onSuccess: (data) => {
      const { turnResult } = data;
      const lines = [
        ...turnResult.log,
        `→ Status: ${turnResult.encounterStatus}`,
      ];
      if (turnResult.lootDropped) lines.push(`[LOOT] ${turnResult.lootDropped}`);
      setCombatLog((prev) => [...lines.reverse(), ...prev]);
      if (turnResult.encounterStatus !== "active") {
        setActiveEncounterId(null);
        setActiveFrogId(null);
      }
      refetchEncounters();
    },
  });

  const [selectedFrogId, setSelectedFrogId] = useState<string>("");
  const [selectedEnemyId, setSelectedEnemyId] = useState<string>("swamp-toad");
  const [activeEncounterId, setActiveEncounterId] = useState<number | null>(null);
  const [activeFrogId, setActiveFrogId] = useState<number | null>(null);
  const [combatLog, setCombatLog] = useState<string[]>([]);

  const aliveFrogs = frogs?.filter((f) => !f.isDead) ?? [];

  return (
    <div style={{ display: "flex", gap: 16 }}>
      <div style={{ flex: "0 0 280px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ background: "#0a1120", border: "1px solid #1e2a3a", borderRadius: 8, padding: 14 }}>
          <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>Start New Encounter</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <Label style={{ fontSize: 11, color: "#6b7280" }}>Frog</Label>
              <select
                value={selectedFrogId}
                onChange={(e) => setSelectedFrogId(e.target.value)}
                style={{
                  width: "100%", marginTop: 4, padding: "6px 8px",
                  background: "#0f1929", border: "1px solid #1e2a3a",
                  borderRadius: 6, color: "#e2e8f0", fontSize: 13,
                }}
              >
                <option value="">Select frog...</option>
                {aliveFrogs.map((f) => (
                  <option key={f.id} value={f.id}>
                    #{f.id} {f.name} (Lv.{f.level})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label style={{ fontSize: 11, color: "#6b7280" }}>Enemy</Label>
              <select
                value={selectedEnemyId}
                onChange={(e) => setSelectedEnemyId(e.target.value)}
                style={{
                  width: "100%", marginTop: 4, padding: "6px 8px",
                  background: "#0f1929", border: "1px solid #1e2a3a",
                  borderRadius: 6, color: "#e2e8f0", fontSize: 13,
                }}
              >
                {ENEMY_TEMPLATES.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
            <Button
              size="sm"
              disabled={!selectedFrogId || startEncounter.isPending || !!activeEncounterId}
              onClick={() => {
                if (!selectedFrogId) return;
                startEncounter.mutate({ frogId: parseInt(selectedFrogId), enemyId: selectedEnemyId });
              }}
            >
              {activeEncounterId ? "Encounter Active" : "Start Encounter"}
            </Button>
          </div>
        </div>

        {activeEncounterId && activeFrogId && (
          <div style={{ background: "#0a1120", border: "1px solid #1e2a3a", borderRadius: 8, padding: 14 }}>
            <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>
              Encounter #{activeEncounterId} — Submit Move
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {MOVE_TYPES.map((move) => (
                <Button
                  key={move}
                  size="sm"
                  variant="outline"
                  disabled={submitMove.isPending}
                  onClick={() =>
                    submitMove.mutate({
                      encounterId: activeEncounterId,
                      frogId: activeFrogId,
                      moveType: move,
                    })
                  }
                  style={{ justifyContent: "flex-start" }}
                >
                  {move}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div style={{ background: "#0a1120", border: "1px solid #1e2a3a", borderRadius: 8, padding: 14 }}>
          <p style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>
            Active Encounters: {activeEncounters?.length ?? 0}
          </p>
          {activeEncounters?.map((enc) => (
            <div key={enc.id} style={{ fontSize: 12, color: "#6b7280", marginBottom: 2 }}>
              #{enc.id} — Frog {enc.frogId} — Turn {enc.currentTurn}
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, alignItems: "center" }}>
          <p style={{ fontSize: 12, color: "#9ca3af" }}>Combat Log</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCombatLog([])}
            style={{ fontSize: 11, padding: "2px 8px", height: "auto" }}
          >
            Clear
          </Button>
        </div>
        <ScrollArea style={{ height: 500, background: "#0a1120", border: "1px solid #1e2a3a", borderRadius: 8, padding: 12 }}>
          {combatLog.length === 0 ? (
            <p style={{ color: "#4b5563", fontSize: 13, fontStyle: "italic" }}>
              No combat yet. Start an encounter to begin.
            </p>
          ) : (
            combatLog.map((line, i) => (
              <p
                key={i}
                style={{
                  fontSize: 12,
                  color: line.startsWith("[START]") ? "#60a5fa"
                    : line.startsWith("→ Status") ? "#9ca3af"
                    : line.startsWith("[LOOT]") ? "#fde68a"
                    : "#e2e8f0",
                  marginBottom: 3,
                  fontFamily: "monospace",
                }}
              >
                {line}
              </p>
            ))
          )}
        </ScrollArea>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// LOOT TAB
// ─────────────────────────────────────────────

function LootTab() {
  const { data: lootItems, refetch } = trpc.admin.listLoot.useQuery();
  const { data: frogs } = trpc.admin.listFrogs.useQuery();
  const seedLoot = trpc.admin.seedLoot.useMutation({ onSuccess: () => refetch() });
  const grantLoot = trpc.admin.grantLoot.useMutation();

  const [grantFrogId, setGrantFrogId] = useState<string>("");
  const [grantLootId, setGrantLootId] = useState<string>("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Button
          size="sm"
          disabled={seedLoot.isPending}
          onClick={() => seedLoot.mutate()}
        >
          Seed 12-Tier Loot Table
        </Button>
        {seedLoot.data && (
          <span style={{ fontSize: 12, color: seedLoot.data.success ? "#4ade80" : "#f87171" }}>
            {seedLoot.data.message}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <div>
          <Label style={{ fontSize: 11, color: "#6b7280" }}>Frog</Label>
          <select
            value={grantFrogId}
            onChange={(e) => setGrantFrogId(e.target.value)}
            style={{
              display: "block", marginTop: 4, padding: "6px 8px",
              background: "#0f1929", border: "1px solid #1e2a3a",
              borderRadius: 6, color: "#e2e8f0", fontSize: 13, width: 180,
            }}
          >
            <option value="">Select frog...</option>
            {frogs?.filter((f) => !f.isDead).map((f) => (
              <option key={f.id} value={f.id}>#{f.id} {f.name}</option>
            ))}
          </select>
        </div>
        <div>
          <Label style={{ fontSize: 11, color: "#6b7280" }}>Loot Item</Label>
          <select
            value={grantLootId}
            onChange={(e) => setGrantLootId(e.target.value)}
            style={{
              display: "block", marginTop: 4, padding: "6px 8px",
              background: "#0f1929", border: "1px solid #1e2a3a",
              borderRadius: 6, color: "#e2e8f0", fontSize: 13, width: 220,
            }}
          >
            <option value="">Select item...</option>
            {lootItems?.map((l) => (
              <option key={l.id} value={l.id}>
                [{l.rarityLabel}] {l.name}
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          disabled={!grantFrogId || !grantLootId || grantLoot.isPending}
          onClick={() => {
            grantLoot.mutate({ frogId: parseInt(grantFrogId), lootId: parseInt(grantLootId) });
          }}
        >
          Grant Item
        </Button>
        {grantLoot.isSuccess && (
          <span style={{ fontSize: 12, color: "#4ade80" }}>Granted!</span>
        )}
      </div>

      <ScrollArea style={{ height: 420 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1e2a3a", color: "#9ca3af", textAlign: "left" }}>
              <th style={{ padding: "6px 10px" }}>Tier</th>
              <th style={{ padding: "6px 10px" }}>Rarity</th>
              <th style={{ padding: "6px 10px" }}>Name</th>
              <th style={{ padding: "6px 10px" }}>ATK+</th>
              <th style={{ padding: "6px 10px" }}>DEF+</th>
              <th style={{ padding: "6px 10px" }}>HP+</th>
              <th style={{ padding: "6px 10px" }}>MP+</th>
              <th style={{ padding: "6px 10px" }}>Drop%</th>
            </tr>
          </thead>
          <tbody>
            {lootItems?.map((l) => (
              <tr key={l.id} style={{ borderBottom: "1px solid #0f1929" }}>
                <td style={{ padding: "6px 10px", color: "#6b7280" }}>{l.tier}</td>
                <td style={{ padding: "6px 10px" }}>
                  <span style={{ color: RARITY_COLORS[l.rarityLabel] ?? "#e2e8f0", fontWeight: 600 }}>
                    {l.rarityLabel}
                  </span>
                </td>
                <td style={{ padding: "6px 10px" }}>{l.name}</td>
                <td style={{ padding: "6px 10px", color: "#f87171" }}>{l.attackBonus > 0 ? `+${l.attackBonus}` : "—"}</td>
                <td style={{ padding: "6px 10px", color: "#60a5fa" }}>{l.defenseBonus > 0 ? `+${l.defenseBonus}` : "—"}</td>
                <td style={{ padding: "6px 10px", color: "#4ade80" }}>{l.hpBonus > 0 ? `+${l.hpBonus}` : "—"}</td>
                <td style={{ padding: "6px 10px", color: "#818cf8" }}>{l.mpBonus > 0 ? `+${l.mpBonus}` : "—"}</td>
                <td style={{ padding: "6px 10px", color: "#9ca3af" }}>{(l.dropRate * 100).toFixed(1)}%</td>
              </tr>
            ))}
            {(!lootItems || lootItems.length === 0) && (
              <tr>
                <td colSpan={8} style={{ padding: "20px 10px", textAlign: "center", color: "#4b5563", fontStyle: "italic" }}>
                  No loot in database. Click "Seed 12-Tier Loot Table" above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

// ─────────────────────────────────────────────
// WORLD TAB (chunks + 1-of-1 items)
// ─────────────────────────────────────────────

const TIER_COLORS: Record<number, string> = {
  1:  "#9ca3af",
  2:  "#4ade80",
  3:  "#60a5fa",
  4:  "#c084fc",
  5:  "#fb923c",
  6:  "#f43f5e",
  7:  "#e0f2fe",
  8:  "#7c3aed",
  9:  "#fde68a",
  10: "#f0abfc",
  11: "#fca5a5",
  12: "#ffd700",
};

const TIER_LABELS: Record<number, string> = {
  1:  "Common",
  2:  "Uncommon",
  3:  "Rare",
  4:  "Epic",
  5:  "Legendary",
  6:  "Mythic",
  7:  "Celestial",
  8:  "Abyssal",
  9:  "Divine",
  10: "Transcendent",
  11: "Primordial",
  12: "Mythic Transcendent",
};

// ─────────────────────────────────────────────
// CHUNKS TABLE (shared sub-component)
// ─────────────────────────────────────────────

function ChunksTable({ onFocus }: { onFocus: (chunkX: number, chunkY: number) => void }) {
  const { data: chunks } = trpc.admin.listChunks.useQuery();

  return (
    <div>
      <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>
        Spawned Chunks ({chunks?.length ?? 0})
      </p>
      <ScrollArea style={{ height: 260 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #1e2a3a", color: "#9ca3af", textAlign: "left" }}>
              <th style={{ padding: "6px 8px" }}>Coords</th>
              <th style={{ padding: "6px 8px" }}>Biome</th>
              <th style={{ padding: "6px 8px" }}>Has Terrain</th>
              <th style={{ padding: "6px 8px" }}>Created</th>
              <th style={{ padding: "6px 8px" }}></th>
            </tr>
          </thead>
          <tbody>
            {chunks?.map((chunk) => (
              <tr key={chunk.id} style={{ borderBottom: "1px solid #0f1929" }}>
                <td style={{ padding: "6px 8px", fontFamily: "monospace", color: "#60a5fa" }}>
                  ({chunk.chunkX}, {chunk.chunkY})
                </td>
                <td style={{ padding: "6px 8px", color: "#9ca3af", textTransform: "capitalize" }}>
                  {chunk.biome}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <span style={{ color: chunk.terrainDataJson ? "#4ade80" : "#f87171", fontSize: 11 }}>
                    {chunk.terrainDataJson ? "yes" : "no"}
                  </span>
                </td>
                <td style={{ padding: "6px 8px", color: "#4b5563", fontSize: 11 }}>
                  {new Date(chunk.createdAt).toLocaleString()}
                </td>
                <td style={{ padding: "6px 8px" }}>
                  <Button
                    size="sm"
                    variant="outline"
                    style={{ fontSize: 10, height: 24, padding: "0 8px" }}
                    onClick={() => onFocus(chunk.chunkX, chunk.chunkY)}
                  >
                    Focus
                  </Button>
                </td>
              </tr>
            ))}
            {(!chunks || chunks.length === 0) && (
              <tr>
                <td colSpan={5} style={{ padding: "20px 8px", textAlign: "center", color: "#4b5563", fontStyle: "italic" }}>
                  No chunks spawned yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

// ─────────────────────────────────────────────
// ITEMS TAB
// ─────────────────────────────────────────────

function ItemsTab() {
  const utils = trpc.useUtils();
  const { data: worldStats } = trpc.admin.getWorldStats.useQuery();
  const { data: itemsList } = trpc.admin.listItems.useQuery();

  const spawnItem = trpc.admin.spawnItem.useMutation({
    onSuccess: () => {
      utils.admin.getWorldStats.invalidate();
      utils.admin.listItems.invalidate();
    },
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Rarity tier breakdown */}
      <div>
        <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>Items by Rarity Tier</p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((tier) => {
            const cnt = worldStats?.itemsByTier?.[tier] ?? 0;
            return (
              <div
                key={tier}
                style={{
                  padding: "4px 10px",
                  borderRadius: 12,
                  border: `1px solid ${TIER_COLORS[tier]}`,
                  fontSize: 11,
                  color: TIER_COLORS[tier],
                  opacity: cnt === 0 ? 0.35 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                T{tier} · {cnt}
              </div>
            );
          })}
        </div>
      </div>

      {/* Spawn action */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Button
          size="sm"
          disabled={spawnItem.isPending}
          onClick={() =>
            spawnItem.mutate({
              name: "The Sacred Lily Pad",
              rarityTier: 12,
              stats: { attackBonus: 50, defenseBonus: 40, hpBonus: 200, mpBonus: 100, specialAbility: "Ribbit of Doom" },
              ownerType: "world_drop",
              ownerId: null,
              locationDropped: "chunk:0:0",
            })
          }
        >
          Spawn Test Item (T12)
        </Button>
        {spawnItem.isSuccess && <span style={{ fontSize: 12, color: "#fde68a" }}>Item spawned!</span>}
        {spawnItem.isError && <span style={{ fontSize: 12, color: "#f87171" }}>{spawnItem.error?.message}</span>}
      </div>

      {/* Items table */}
      <div>
        <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>
          Latest {itemsList?.length ?? 0} Items
        </p>
        <ScrollArea style={{ height: 400 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #1e2a3a", color: "#9ca3af", textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>UUID</th>
                <th style={{ padding: "6px 8px" }}>Name</th>
                <th style={{ padding: "6px 8px" }}>Tier</th>
                <th style={{ padding: "6px 8px" }}>Owner Type</th>
                <th style={{ padding: "6px 8px" }}>Owner ID</th>
                <th style={{ padding: "6px 8px" }}>Location</th>
                <th style={{ padding: "6px 8px" }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {itemsList?.map((item) => (
                <tr key={item.itemId} style={{ borderBottom: "1px solid #0f1929" }}>
                  <td style={{ padding: "6px 8px", color: "#6b7280", fontFamily: "monospace" }}>
                    {item.itemId.slice(0, 8)}…
                  </td>
                  <td style={{ padding: "6px 8px", color: TIER_COLORS[item.rarityTier] ?? "#e2e8f0", fontWeight: 600 }}>
                    {item.name}
                  </td>
                  <td style={{ padding: "6px 8px" }}>
                    <span style={{ color: TIER_COLORS[item.rarityTier], fontSize: 11 }}>
                      T{item.rarityTier} {TIER_LABELS[item.rarityTier]}
                    </span>
                  </td>
                  <td style={{ padding: "6px 8px", color: "#9ca3af" }}>{item.ownerType}</td>
                  <td style={{ padding: "6px 8px", color: "#6b7280" }}>{item.ownerId ?? "—"}</td>
                  <td style={{ padding: "6px 8px", color: "#6b7280" }}>{item.locationDropped ?? "—"}</td>
                  <td style={{ padding: "6px 8px", color: "#4b5563", fontSize: 11 }}>
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {(!itemsList || itemsList.length === 0) && (
                <tr>
                  <td colSpan={7} style={{ padding: "20px 8px", textAlign: "center", color: "#4b5563", fontStyle: "italic" }}>
                    No items yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollArea>
      </div>
    </div>
  );
}

const DIRECTIONS = [
  { label: "NW", dx: -1, dy: -1 },
  { label: "N",  dx:  0, dy: -1 },
  { label: "NE", dx:  1, dy: -1 },
  { label: "W",  dx: -1, dy:  0 },
  { label: "·",  dx:  0, dy:  0 },
  { label: "E",  dx:  1, dy:  0 },
  { label: "SW", dx: -1, dy:  1 },
  { label: "S",  dx:  0, dy:  1 },
  { label: "SE", dx:  1, dy:  1 },
] as const;

function WorldTab() {
  const utils = trpc.useUtils();
  const { data: worldStats, isLoading: statsLoading } = trpc.admin.getWorldStats.useQuery();

  const [centerChunk, setCenterChunk] = useState({ chunkX: 0, chunkY: 0 });

  const neighborCoords = useMemo(() => {
    const coords = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        coords.push({ chunkX: centerChunk.chunkX + dx, chunkY: centerChunk.chunkY + dy });
    return coords;
  }, [centerChunk.chunkX, centerChunk.chunkY]);

  const { data: chunkMap } = trpc.admin.getChunksByCoords.useQuery({ coords: neighborCoords });

  const spawnChunk = trpc.admin.spawnChunk.useMutation({
    onSuccess: () => {
      utils.admin.getWorldStats.invalidate();
      utils.admin.getChunksByCoords.invalidate();
      utils.admin.listChunks.invalidate();
    },
  });

  const statCards = [
    { label: "Total Chunks", value: worldStats?.totalChunks ?? 0, color: "#60a5fa" },
    { label: "Active Chunks", value: worldStats?.activeChunks ?? 0, color: "#4ade80" },
    { label: "Total Items",   value: worldStats?.totalItems ?? 0,   color: "#fde68a" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Stat cards */}
      <div style={{ display: "flex", gap: 12 }}>
        {statCards.map((card) => (
          <div
            key={card.label}
            style={{
              flex: 1,
              background: "#0a1120",
              border: "1px solid #1e2a3a",
              borderRadius: 8,
              padding: "14px 18px",
            }}
          >
            <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{card.label}</p>
            <p style={{ fontSize: 28, fontWeight: 700, color: card.color, margin: 0 }}>
              {statsLoading ? "—" : card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Map preview + directional spawn */}
      <div
        style={{
          background: "#0a1120",
          border: "1px solid #1e2a3a",
          borderRadius: 8,
          padding: "14px 18px",
        }}
      >
        <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>
          Map Preview · Center ({centerChunk.chunkX}, {centerChunk.chunkY}) · 3×3 Neighborhood
        </p>
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
          <Viewport
            centerChunkX={centerChunk.chunkX}
            centerChunkY={centerChunk.chunkY}
            chunks={chunkMap ?? {}}
          />
          <div style={{ flexShrink: 0 }}>
            <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>Spawn Chunk</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 48px)", gap: 4 }}>
              {DIRECTIONS.map(({ label, dx, dy }) => {
                const targetX = centerChunk.chunkX + dx;
                const targetY = centerChunk.chunkY + dy;
                const key = `${targetX}:${targetY}`;
                const alreadySpawned = chunkMap ? key in chunkMap : false;
                return (
                  <Button
                    key={label}
                    size="sm"
                    variant={alreadySpawned ? "outline" : "default"}
                    disabled={spawnChunk.isPending}
                    onClick={() =>
                      spawnChunk.mutate(
                        { chunkX: targetX, chunkY: targetY, biome: "grassland" },
                        { onSuccess: () => setCenterChunk({ chunkX: targetX, chunkY: targetY }) }
                      )
                    }
                    style={{ fontSize: 11, height: 36, padding: 0 }}
                    title={`Spawn (${targetX}, ${targetY})`}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
            <p style={{ fontSize: 10, color: "#4b5563", marginTop: 8 }}>
              Outline = already spawned
            </p>
            {spawnChunk.isSuccess && (
              <p style={{ fontSize: 12, color: "#4ade80", marginTop: 6 }}>Chunk spawned!</p>
            )}
            {spawnChunk.isError && (
              <p style={{ fontSize: 12, color: "#f87171", marginTop: 6 }}>
                {spawnChunk.error?.message}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Spawned chunks table */}
      <ChunksTable onFocus={(x, y) => setCenterChunk({ chunkX: x, chunkY: y })} />
    </div>
  );
}

// ─────────────────────────────────────────────
// WORLD LOG TAB
// ─────────────────────────────────────────────

const EVENT_TYPE_COLORS: Record<string, string> = {
  ENCOUNTER_START: "#60a5fa",
  COMBAT_TURN:     "#4ade80",
  HEAL_FROG:       "#34d399",
  SMITE_ENEMY:     "#f87171",
  FROG_DEATH:      "#ef4444",
};

function WorldLogTab() {
  const { entries, connected } = useWorldLog({ role: "spectator" });
  const { data: recent } = trpc.worldLog.recent.useQuery({ limit: 50 });

  const [filter, setFilter] = useState<string | null>(null);

  const recentParsed = recent ?? [];
  const liveEntries = entries;

  const allFilters = ["ENCOUNTER_START", "COMBAT_TURN", "HEAL_FROG", "SMITE_ENEMY"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13 }}>
          <StatusDot ok={connected} />
          {connected ? "Live" : "Disconnected"}
        </span>
        <span style={{ fontSize: 12, color: "#6b7280" }}>
          {liveEntries.length} live | {recentParsed.length} recent DB
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setFilter(null)}
            style={{
              padding: "3px 10px", borderRadius: 12, fontSize: 11, cursor: "pointer",
              background: filter === null ? "#1e40af" : "transparent",
              border: `1px solid ${filter === null ? "#3b82f6" : "#1e2a3a"}`,
              color: filter === null ? "#93c5fd" : "#6b7280",
            }}
          >
            All
          </button>
          {allFilters.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(filter === f ? null : f)}
              style={{
                padding: "3px 10px", borderRadius: 12, fontSize: 11, cursor: "pointer",
                background: filter === f ? "#1e2f1e" : "transparent",
                border: `1px solid ${filter === f ? "#4ade80" : "#1e2a3a"}`,
                color: EVENT_TYPE_COLORS[f] ?? "#6b7280",
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>Live Stream</p>
          <ScrollArea style={{ height: 460, background: "#0a1120", border: "1px solid #1e2a3a", borderRadius: 8, padding: 10 }}>
            {liveEntries.length === 0 ? (
              <p style={{ color: "#4b5563", fontSize: 12, fontStyle: "italic" }}>Waiting for events...</p>
            ) : (
              liveEntries
                .filter((e) => !filter || e.eventType === filter)
                .map((entry, i) => (
                  <div key={i} style={{ marginBottom: 6, borderBottom: "1px solid #0f1929", paddingBottom: 6 }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: EVENT_TYPE_COLORS[entry.eventType] ?? "#9ca3af",
                        marginRight: 6,
                      }}
                    >
                      {entry.eventType}
                    </span>
                    <span style={{ fontSize: 12, color: "#e2e8f0" }}>{entry.message}</span>
                    {entry.frogName && (
                      <span style={{ fontSize: 11, color: "#6b7280", marginLeft: 6 }}>@{entry.frogName}</span>
                    )}
                  </div>
                ))
            )}
          </ScrollArea>
        </div>

        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>Recent DB Events</p>
          <ScrollArea style={{ height: 460, background: "#0a1120", border: "1px solid #1e2a3a", borderRadius: 8, padding: 10 }}>
            {recentParsed
              .filter((e) => !filter || e.eventType === filter)
              .map((entry) => (
                <div key={entry.id} style={{ marginBottom: 6, borderBottom: "1px solid #0f1929", paddingBottom: 6 }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: EVENT_TYPE_COLORS[entry.eventType] ?? "#9ca3af",
                      marginRight: 6,
                    }}
                  >
                    {entry.eventType}
                  </span>
                  <span style={{ fontSize: 12, color: "#e2e8f0" }}>
                    {typeof entry.payload === "object" && entry.payload !== null
                      ? (entry.payload as { message?: string }).message ?? JSON.stringify(entry.payload)
                      : String(entry.payload)}
                  </span>
                </div>
              ))}
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// UX TESTING DROPDOWN
// ─────────────────────────────────────────────

function UxTestingDropdown() {
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <div
        style={{
          padding: "6px 12px",
          fontSize: 13,
          fontFamily: "'Cinzel', serif",
          color: open ? "#fde68a" : "#9ca3af",
          cursor: "default",
          letterSpacing: "0.05em",
          userSelect: "none",
          borderRadius: 6,
          background: open ? "#0f1929" : "transparent",
          transition: "color 0.15s, background 0.15s",
          whiteSpace: "nowrap",
        }}
      >
        USER EXPERIENCE TESTING ▾
      </div>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 50,
            background: "#0a1120",
            border: "1px solid #1e2a3a",
            borderRadius: 8,
            minWidth: 200,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            overflow: "hidden",
          }}
        >
          <Link href="/testing-ground">
            <div
              style={{
                padding: "10px 16px",
                fontSize: 13,
                color: "#e2e8f0",
                cursor: "pointer",
                borderBottom: "1px solid #1e2a3a",
                fontFamily: "'Cinzel', serif",
                letterSpacing: "0.04em",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#0f1929")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              TESTING GROUND
            </div>
          </Link>
          <div
            style={{
              padding: "10px 16px",
              fontSize: 13,
              color: "#4b5563",
              cursor: "not-allowed",
              fontFamily: "'Cinzel', serif",
              letterSpacing: "0.04em",
            }}
          >
            COMING SOON
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// ROOT ADMIN PANEL
// ─────────────────────────────────────────────

export default function Admin() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "oklch(0.10 0.015 240)",
        color: "oklch(0.92 0.025 80)",
        fontFamily: "'Crimson Text', serif",
        padding: "24px 32px",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 28, fontFamily: "'Cinzel', serif", color: "#fde68a", margin: 0 }}>
              Frogs & Gods — Admin Console
            </h1>
            <p style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>
              Game state inspector and test harness
            </p>
          </div>
          {import.meta.env.DEV && (
            <button
              onClick={() =>
                fetch("/api/dev-login", { method: "POST", credentials: "include" })
                  .then(() => window.location.reload())
              }
              style={{
                padding: "6px 14px",
                fontSize: 12,
                fontFamily: "'Cinzel', serif",
                background: "#0f1929",
                border: "1px solid #1e2a3a",
                borderRadius: 6,
                color: "#4ade80",
                cursor: "pointer",
                letterSpacing: "0.04em",
              }}
            >
              DEV LOGIN
            </button>
          )}
        </div>

        <Tabs defaultValue="frogs">
          <div style={{ display: "flex", alignItems: "center", marginBottom: 20, gap: 8 }}>
            <TabsList
              style={{
                background: "#0a1120",
                border: "1px solid #1e2a3a",
              }}
            >
              <TabsTrigger value="users">Users</TabsTrigger>
              <TabsTrigger value="frogs">Frogs</TabsTrigger>
              <TabsTrigger value="gods">Gods</TabsTrigger>
              <TabsTrigger value="combat">Combat</TabsTrigger>
              <TabsTrigger value="loot">Loot</TabsTrigger>
              <TabsTrigger value="world">World</TabsTrigger>
              <TabsTrigger value="items">Items</TabsTrigger>
              <TabsTrigger value="log">World Log</TabsTrigger>
            </TabsList>
            <UxTestingDropdown />
          </div>

          <div
            style={{
              background: "#0c1525",
              border: "1px solid #1e2a3a",
              borderRadius: 10,
              padding: 20,
            }}
          >
            <TabsContent value="users"><UsersTab /></TabsContent>
            <TabsContent value="frogs"><FrogsTab /></TabsContent>
            <TabsContent value="gods"><GodsTab /></TabsContent>
            <TabsContent value="combat"><CombatTab /></TabsContent>
            <TabsContent value="loot"><LootTab /></TabsContent>
            <TabsContent value="world"><WorldTab /></TabsContent>
            <TabsContent value="items"><ItemsTab /></TabsContent>
            <TabsContent value="log"><WorldLogTab /></TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
