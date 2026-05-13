import { useState, useCallback, useEffect } from "react";

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const KNOWN_ACTIONS = [
  "STEP", "HOP", "EQUIP", "UNEQUIP",
  "THROW", "STORE_ITEM", "GIVE", "SWING", "PICKUP",
] as const;

type Template = "swing" | "passive" | "custom";

const INPUT_STYLE: React.CSSProperties = {
  background: "#060d18",
  border: "1px solid #1e2a3a",
  borderRadius: 4,
  padding: "5px 8px",
  color: "#e2e8f0",
  fontSize: 12,
  boxSizing: "border-box",
  width: "100%",
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  color: "#6b7280",
  marginBottom: 3,
};

const SECTION_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

// ─────────────────────────────────────────────
// BUILDERS
// ─────────────────────────────────────────────

interface SwingState {
  attackBonus: number;
  defenseBonus: number;
  hpBonus: number;
  blockedActions: string[];
  castTimeMs: number;
  targetingCount: number;
  adjacencyRequired: boolean;
  maxRange: number;
}

interface PassiveState {
  attackBonus: number;
  defenseBonus: number;
  hpBonus: number;
}

function buildSwingStats(s: SwingState): object {
  return {
    attackBonus: s.attackBonus,
    defenseBonus: s.defenseBonus,
    hpBonus: s.hpBonus,
    grantedActions: ["SWING"],
    blockedActions: s.blockedActions,
    actionSchema: {
      action_name: "SWING",
      cast_time_ms: s.castTimeMs,
      targeting: {
        type: "TILE_SELECT",
        count: s.targetingCount,
        adjacency_required: s.adjacencyRequired,
        max_range: s.maxRange,
      },
    },
  };
}

function buildPassiveStats(s: PassiveState): object {
  return {
    attackBonus: s.attackBonus,
    defenseBonus: s.defenseBonus,
    hpBonus: s.hpBonus,
  };
}

function tryParseSwing(json: string): Partial<SwingState> | null {
  try {
    const obj = JSON.parse(json);
    return {
      attackBonus:       obj.attackBonus   ?? 0,
      defenseBonus:      obj.defenseBonus  ?? 0,
      hpBonus:           obj.hpBonus       ?? 0,
      blockedActions:    Array.isArray(obj.blockedActions) ? obj.blockedActions : [],
      castTimeMs:        obj.actionSchema?.cast_time_ms ?? 0,
      targetingCount:    obj.actionSchema?.targeting?.count ?? 1,
      adjacencyRequired: obj.actionSchema?.targeting?.adjacency_required ?? false,
      maxRange:          obj.actionSchema?.targeting?.max_range ?? 1,
    };
  } catch {
    return null;
  }
}

function tryParsePassive(json: string): Partial<PassiveState> | null {
  try {
    const obj = JSON.parse(json);
    return {
      attackBonus:  obj.attackBonus  ?? 0,
      defenseBonus: obj.defenseBonus ?? 0,
      hpBonus:      obj.hpBonus      ?? 0,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// TEMPLATE BUTTON
// ─────────────────────────────────────────────

function TemplateBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 12px",
        fontSize: 11,
        borderRadius: 4,
        border: `1px solid ${active ? "#60a5fa" : "#1e2a3a"}`,
        background: active ? "#0c1f3a" : "#060d18",
        color: active ? "#93c5fd" : "#6b7280",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────
// NUMBER INPUT HELPER
// ─────────────────────────────────────────────

function NumberField({
  label,
  hint,
  value,
  min,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <p style={LABEL_STYLE}>
        {label}
        {hint && <span style={{ color: "#4b5563", marginLeft: 6 }}>{hint}</span>}
      </p>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={INPUT_STYLE}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────

interface ItemStatsFormProps {
  value: string;
  onChange: (json: string) => void;
}

export function ItemStatsForm({ value, onChange }: ItemStatsFormProps) {
  const [template, setTemplate] = useState<Template>("swing");

  const [swing, setSwing] = useState<SwingState>({
    attackBonus: 0,
    defenseBonus: 0,
    hpBonus: 0,
    blockedActions: [],
    castTimeMs: 0,
    targetingCount: 1,
    adjacencyRequired: false,
    maxRange: 1,
  });

  const [passive, setPassive] = useState<PassiveState>({
    attackBonus: 0,
    defenseBonus: 0,
    hpBonus: 0,
  });

  // Derive the live preview object from current template + state
  const previewObj = (() => {
    if (template === "swing")   return buildSwingStats(swing);
    if (template === "passive") return buildPassiveStats(passive);
    try { return JSON.parse(value); } catch { return null; }
  })();

  const previewStr = previewObj ? JSON.stringify(previewObj, null, 2) : value;

  // Push to parent whenever structured state changes
  useEffect(() => {
    if (template === "swing")   onChange(JSON.stringify(buildSwingStats(swing)));
    if (template === "passive") onChange(JSON.stringify(buildPassiveStats(passive)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, swing, passive]);

  const switchTemplate = useCallback((t: Template) => {
    if (t === "swing") {
      const parsed = tryParseSwing(value);
      if (parsed) setSwing((prev) => ({ ...prev, ...parsed }));
    } else if (t === "passive") {
      const parsed = tryParsePassive(value);
      if (parsed) setPassive((prev) => ({ ...prev, ...parsed }));
    }
    setTemplate(t);
  }, [value]);

  function toggleBlocked(action: string) {
    setSwing((s) => ({
      ...s,
      blockedActions: s.blockedActions.includes(action)
        ? s.blockedActions.filter((a) => a !== action)
        : [...s.blockedActions, action],
    }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Template selector */}
      <div>
        <p style={LABEL_STYLE}>Item Template</p>
        <div style={{ display: "flex", gap: 6 }}>
          <TemplateBtn label="Swing Weapon" active={template === "swing"}   onClick={() => switchTemplate("swing")} />
          <TemplateBtn label="Passive Item" active={template === "passive"} onClick={() => switchTemplate("passive")} />
          <TemplateBtn label="Custom JSON"  active={template === "custom"}  onClick={() => switchTemplate("custom")} />
        </div>
      </div>

      {/* ── Swing Weapon fields ── */}
      {template === "swing" && (
        <div style={SECTION_STYLE}>
          {/* Passive bonuses row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <NumberField label="attackBonus"  value={swing.attackBonus}  onChange={(n) => setSwing((s) => ({ ...s, attackBonus: n }))} />
            <NumberField label="defenseBonus" value={swing.defenseBonus} onChange={(n) => setSwing((s) => ({ ...s, defenseBonus: n }))} />
            <NumberField label="hpBonus"      value={swing.hpBonus}      onChange={(n) => setSwing((s) => ({ ...s, hpBonus: n }))} />
          </div>

          {/* grantedActions locked label */}
          <div>
            <p style={LABEL_STYLE}>grantedActions</p>
            <div style={{ ...INPUT_STYLE, color: "#4ade80", width: "auto", display: "inline-block" }}>
              ["SWING"]
            </div>
          </div>

          {/* blockedActions checkboxes */}
          <div>
            <p style={LABEL_STYLE}>blockedActions <span style={{ color: "#4b5563" }}>— fumbles while item is in possession</span></p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
              {KNOWN_ACTIONS.map((action) => (
                <label key={action} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={swing.blockedActions.includes(action)}
                    onChange={() => toggleBlocked(action)}
                    style={{ accentColor: "#f87171" }}
                  />
                  <span style={{ fontSize: 11, color: swing.blockedActions.includes(action) ? "#f87171" : "#6b7280", fontFamily: "monospace" }}>
                    {action}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* actionSchema fields */}
          <div>
            <p style={{ ...LABEL_STYLE, color: "#60a5fa", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              actionSchema
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, paddingLeft: 8, borderLeft: "2px solid #1e2a3a" }}>
              <NumberField
                label="cast_time_ms"
                hint="0 = next sub-tick · 500 = 1 sub-tick delay"
                value={swing.castTimeMs}
                min={0}
                onChange={(n) => setSwing((s) => ({ ...s, castTimeMs: n }))}
              />
              <NumberField
                label="targeting.count"
                hint="tiles player must click"
                value={swing.targetingCount}
                min={1}
                onChange={(n) => setSwing((s) => ({ ...s, targetingCount: Math.max(1, n) }))}
              />
              <NumberField
                label="targeting.max_range"
                hint="Chebyshev dist · 1 = adjacent only"
                value={swing.maxRange}
                min={0}
                onChange={(n) => setSwing((s) => ({ ...s, maxRange: Math.max(0, n) }))}
              />
              <div>
                <p style={LABEL_STYLE}>targeting.adjacency_required <span style={{ color: "#4b5563" }}>UI hint only</span></p>
                <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={swing.adjacencyRequired}
                    onChange={(e) => setSwing((s) => ({ ...s, adjacencyRequired: e.target.checked }))}
                    style={{ accentColor: "#60a5fa" }}
                  />
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>require adjacency</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Passive Item fields ── */}
      {template === "passive" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          <NumberField label="attackBonus"  value={passive.attackBonus}  onChange={(n) => setPassive((s) => ({ ...s, attackBonus: n }))} />
          <NumberField label="defenseBonus" value={passive.defenseBonus} onChange={(n) => setPassive((s) => ({ ...s, defenseBonus: n }))} />
          <NumberField label="hpBonus"      value={passive.hpBonus}      onChange={(n) => setPassive((s) => ({ ...s, hpBonus: n }))} />
        </div>
      )}

      {/* ── Custom JSON textarea ── */}
      {template === "custom" && (
        <div>
          <p style={LABEL_STYLE}>Stats JSON</p>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={5}
            style={{
              ...INPUT_STYLE,
              fontFamily: "monospace",
              fontSize: 11,
              color: "#9ca3af",
              resize: "vertical",
            }}
          />
        </div>
      )}

      {/* ── Live JSONC preview ── */}
      <div>
        <p style={{ ...LABEL_STYLE, color: "#374151" }}>Generated statsJson</p>
        <pre
          style={{
            margin: 0,
            padding: "8px 10px",
            background: "#020810",
            border: "1px solid #111827",
            borderRadius: 4,
            fontSize: 10,
            color: "#4b5563",
            fontFamily: "monospace",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {previewStr}
        </pre>
      </div>

    </div>
  );
}
