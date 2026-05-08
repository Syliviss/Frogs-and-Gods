import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TIER_COLORS: Record<number, string> = {
  1: "#9ca3af", 2: "#4ade80",  3: "#60a5fa", 4: "#c084fc",
  5: "#fb923c", 6: "#f43f5e",  7: "#e0f2fe", 8: "#7c3aed",
  9: "#fde68a", 10: "#f0abfc", 11: "#fca5a5", 12: "#ffd700",
};

const TIER_LABELS: Record<number, string> = {
  1: "Common",       2: "Uncommon",    3: "Rare",        4: "Epic",
  5: "Legendary",    6: "Mythic",      7: "Celestial",   8: "Abyssal",
  9: "Divine",       10: "Transcendent", 11: "Primordial", 12: "Mythic Transcendent",
};

export function InventoryTab() {
  const [selectedFrogId, setSelectedFrogId] = useState<number | null>(null);
  const [pendingFrogs, setPendingFrogs]     = useState<Set<number>>(new Set());
  const [giveItemId, setGiveItemId]         = useState("");
  const [giveFrogId, setGiveFrogId]         = useState("");

  const { data: frogs }  = trpc.admin.listFrogs.useQuery();
  const inventory        = trpc.admin.getInventoryForFrog.useQuery(
    { frogId: selectedFrogId! },
    { enabled: selectedFrogId != null },
  );
  const equipped         = trpc.admin.getEquippedForFrog.useQuery(
    { frogId: selectedFrogId! },
    { enabled: selectedFrogId != null },
  );

  // Pre-fill Give form frogId when the selector changes
  useEffect(() => {
    if (selectedFrogId != null) setGiveFrogId(String(selectedFrogId));
  }, [selectedFrogId]);

  // Sync to ENGINE_TICK — refetch and clear locked-in state on each heartbeat
  useEffect(() => {
    if (selectedFrogId == null) return;
    const ws = new WebSocket(`ws://${window.location.host}/ws`);
    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as { type: string };
        if (msg.type === "ENGINE_TICK") {
          inventory.refetch().catch(() => undefined);
          equipped.refetch().catch(() => undefined);
          setPendingFrogs(new Set());
        }
      } catch { /* ignore malformed frames */ }
    };
    return () => ws.close();
  }, [selectedFrogId]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitAction = trpc.admin.submitActionForFrog.useMutation({
    onSuccess: (_, vars) => {
      setPendingFrogs((prev) => {
        const next = new Set(prev);
        next.add(vars.frogId);
        return next;
      });
    },
  });

  const selectedFrog = frogs?.find((f) => f.id === selectedFrogId);
  const invCap       = (selectedFrog?.statsJson as { inventoryCapacity?: number } | null)?.inventoryCapacity ?? 6;
  const equipCap     = (selectedFrog?.statsJson as { equipCapacity?: number } | null)?.equipCapacity ?? 3;
  const isLocked     = selectedFrogId != null && pendingFrogs.has(selectedFrogId);

  const handleEquip = (itemId: string) =>
    submitAction.mutate({ frogId: selectedFrogId!, actionType: "EQUIP", payload: { itemId } });

  const handleUnequip = (itemId: string) =>
    submitAction.mutate({ frogId: selectedFrogId!, actionType: "UNEQUIP", payload: { itemId } });

  const handleGive = () => {
    const frogId = Number(giveFrogId);
    if (!frogId || !giveItemId.trim()) return;
    submitAction.mutate({ frogId, actionType: "GIVE", payload: { itemId: giveItemId.trim() } });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Frog Selector ─────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Label style={{ color: "#9ca3af", fontSize: 12, whiteSpace: "nowrap" }}>
          Select Frog
        </Label>
        <Select
          value={selectedFrogId != null ? String(selectedFrogId) : ""}
          onValueChange={(v) => setSelectedFrogId(Number(v))}
        >
          <SelectTrigger
            style={{
              width: 240,
              fontSize: 12,
              background: "#0a1120",
              borderColor: "#1e2a3a",
              color: "#e2e8f0",
            }}
          >
            <SelectValue placeholder="— choose a frog —" />
          </SelectTrigger>
          <SelectContent style={{ background: "#0a1120", borderColor: "#1e2a3a" }}>
            {frogs?.map((f) => (
              <SelectItem
                key={f.id}
                value={String(f.id)}
                style={{ fontSize: 12, color: "#e2e8f0" }}
              >
                #{f.id} — {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isLocked && (
          <span style={{ fontSize: 11, color: "#fde68a", display: "flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#fde68a",
              }}
            />
            Action locked in… waiting for heartbeat
          </span>
        )}
      </div>

      {selectedFrogId == null ? (
        <p style={{ color: "#4b5563", fontSize: 13, fontStyle: "italic" }}>
          Select a frog to view its stomach and equipped items.
        </p>
      ) : (
        <>
          {/* ── Stomach (Inventory) ─────────────────── */}
          <div>
            <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>
              Stomach ({inventory.data?.length ?? 0} / {invCap})
            </p>
            <ScrollArea style={{ height: 200 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e2a3a", color: "#9ca3af", textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>UUID</th>
                    <th style={{ padding: "6px 8px" }}>Name</th>
                    <th style={{ padding: "6px 8px" }}>Tier</th>
                    <th style={{ padding: "6px 8px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.data?.map((item) => (
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
                      <td style={{ padding: "6px 8px" }}>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isLocked || submitAction.isPending}
                          onClick={() => handleEquip(item.itemId)}
                          style={{
                            fontSize: 10,
                            height: 22,
                            padding: "0 8px",
                            opacity: isLocked ? 0.4 : 1,
                          }}
                        >
                          Equip
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(!inventory.data || inventory.data.length === 0) && (
                    <tr>
                      <td
                        colSpan={4}
                        style={{ padding: "20px 8px", textAlign: "center", color: "#4b5563", fontStyle: "italic" }}
                      >
                        Stomach is empty.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
          </div>

          {/* ── Equipped ───────────────────────────── */}
          <div>
            <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>
              Equipped ({equipped.data?.length ?? 0} / {equipCap})
            </p>
            <ScrollArea style={{ height: 160 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1e2a3a", color: "#9ca3af", textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>UUID</th>
                    <th style={{ padding: "6px 8px" }}>Name</th>
                    <th style={{ padding: "6px 8px" }}>Tier</th>
                    <th style={{ padding: "6px 8px" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {equipped.data?.map((item) => (
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
                      <td style={{ padding: "6px 8px" }}>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isLocked || submitAction.isPending}
                          onClick={() => handleUnequip(item.itemId)}
                          style={{
                            fontSize: 10,
                            height: 22,
                            padding: "0 8px",
                            opacity: isLocked ? 0.4 : 1,
                          }}
                        >
                          Unequip
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(!equipped.data || equipped.data.length === 0) && (
                    <tr>
                      <td
                        colSpan={4}
                        style={{ padding: "20px 8px", textAlign: "center", color: "#4b5563", fontStyle: "italic" }}
                      >
                        Nothing equipped.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
          </div>
        </>
      )}

      {/* ── Give Item Form ─────────────────────────── */}
      <div style={{ borderTop: "1px solid #1e2a3a", paddingTop: 16 }}>
        <p style={{ fontSize: 11, color: "#6b7280", marginBottom: 12 }}>Give Item</p>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Label style={{ fontSize: 11, color: "#9ca3af" }}>Item UUID</Label>
            <Input
              value={giveItemId}
              onChange={(e) => setGiveItemId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-…"
              style={{
                width: 280,
                fontSize: 12,
                background: "#0a1120",
                borderColor: "#1e2a3a",
                color: "#e2e8f0",
                height: 32,
              }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Label style={{ fontSize: 11, color: "#9ca3af" }}>Frog ID</Label>
            <Input
              value={giveFrogId}
              onChange={(e) => setGiveFrogId(e.target.value)}
              placeholder="frog id"
              style={{
                width: 90,
                fontSize: 12,
                background: "#0a1120",
                borderColor: "#1e2a3a",
                color: "#e2e8f0",
                height: 32,
              }}
            />
          </div>
          <Button
            size="sm"
            disabled={!giveItemId.trim() || !giveFrogId || submitAction.isPending}
            onClick={handleGive}
            style={{ height: 32 }}
          >
            Grant
          </Button>
          {submitAction.isSuccess && (
            <span style={{ fontSize: 12, color: "#fde68a" }}>Queued!</span>
          )}
          {submitAction.isError && (
            <span style={{ fontSize: 12, color: "#f87171" }}>
              {submitAction.error?.message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
