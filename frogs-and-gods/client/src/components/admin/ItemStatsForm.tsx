import { useState, useCallback, useEffect } from "react";

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const KNOWN_ACTIONS = [
  "STEP", "HOP", "EQUIP", "UNEQUIP",
  "THROW", "STORE_ITEM", "GIVE", "SWING", "PICKUP",
] as const;

const BONUS_FIELDS = [
  "attackBonus", "defenseBonus", "hpBonus", "manaBonus", "breathBonus",
  "strBonus", "dexBonus", "wisBonus", "intBonus", "chaBonus",
] as const;
type BonusField = (typeof BONUS_FIELDS)[number];
type Bonuses = Record<BonusField, number>;

type Template = "item" | "custom";

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
  gap: 12,
};

// ─────────────────────────────────────────────
// STATE & BUILDER
// ─────────────────────────────────────────────

interface ItemState {
  bonuses:           Bonuses;
  blockedActions:    string[];
  grantsAction:      boolean;
  actionName:        string;
  castTimeMs:        number;
  targetingCount:    number;
  adjacencyRequired: boolean;
  maxRange:          number;
}

const EMPTY_BONUSES: Bonuses = BONUS_FIELDS.reduce(
  (acc, k) => ({ ...acc, [k]: 0 }),
  {} as Bonuses,
);

const DEFAULT_STATE: ItemState = {
  bonuses:           { ...EMPTY_BONUSES },
  blockedActions:    [],
  grantsAction:      true,
  actionName:        "SWING",
  castTimeMs:        0,
  targetingCount:    1,
  adjacencyRequired: false,
  maxRange:          1,
};

function buildItemStats(s: ItemState): object {
  const out: Record<string, unknown> = {};
  for (const k of BONUS_FIELDS) {
    if (s.bonuses[k] !== 0) out[k] = s.bonuses[k];
  }
  if (s.blockedActions.length > 0) out.blockedActions = s.blockedActions;
  if (s.grantsAction && s.actionName.trim() !== "") {
    const name = s.actionName.trim();
    out.grantedActions = [name];
    out.actionSchema = {
      action_name: name,
      cast_time_ms: s.castTimeMs,
      targeting: {
        type: "TILE_SELECT",
        count: s.targetingCount,
        adjacency_required: s.adjacencyRequired,
        max_range: s.maxRange,
      },
    };
  }
  return out;
}

function tryParseItem(json: string): Partial<ItemState> | null {
  try {
    const obj = JSON.parse(json);
    const bonuses: Bonuses = { ...EMPTY_BONUSES };
    for (const k of BONUS_FIELDS) {
      if (typeof obj[k] === "number") bonuses[k] = obj[k];
    }
    const grantedActions = Array.isArray(obj.grantedActions) ? obj.grantedActions : [];
    const grantsAction   = grantedActions.length > 0 || !!obj.actionSchema;
    const actionName     = obj.actionSchema?.action_name ?? grantedActions[0] ?? "SWING";
    return {
      bonuses,
      blockedActions:    Array.isArray(obj.blockedActions) ? obj.blockedActions : [],
      grantsAction,
      actionName,
      castTimeMs:        obj.actionSchema?.cast_time_ms ?? 0,
      targetingCount:    obj.actionSchema?.targeting?.count ?? 1,
      adjacencyRequired: obj.actionSchema?.targeting?.adjacency_required ?? false,
      maxRange:          obj.actionSchema?.targeting?.max_range ?? 1,
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
  const [template, setTemplate] = useState<Template>("item");
  const [item, setItem] = useState<ItemState>(DEFAULT_STATE);

  // Derive the live preview object from current template + state
  const previewObj = (() => {
    if (template === "item") return buildItemStats(item);
    try { return JSON.parse(value); } catch { return null; }
  })();

  const previewStr = previewObj ? JSON.stringify(previewObj, null, 2) : value;

  // Push to parent whenever structured state changes
  useEffect(() => {
    if (template === "item") onChange(JSON.stringify(buildItemStats(item)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, item]);

  const switchTemplate = useCallback((t: Template) => {
    if (t === "item") {
      const parsed = tryParseItem(value);
      if (parsed) setItem((prev) => ({ ...prev, ...parsed }));
    }
    setTemplate(t);
  }, [value]);

  function toggleBlocked(action: string) {
    setItem((s) => ({
      ...s,
      blockedActions: s.blockedActions.includes(action)
        ? s.blockedActions.filter((a) => a !== action)
        : [...s.blockedActions, action],
    }));
  }

  function setBonus(field: BonusField, n: number) {
    setItem((s) => ({ ...s, bonuses: { ...s.bonuses, [field]: n } }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Template selector */}
      <div>
        <p style={LABEL_STYLE}>Item Template</p>
        <div style={{ display: "flex", gap: 6 }}>
          <TemplateBtn label="Item"        active={template === "item"}   onClick={() => switchTemplate("item")} />
          <TemplateBtn label="Custom JSON" active={template === "custom"} onClick={() => switchTemplate("custom")} />
        </div>
      </div>

      {/* ── Unified Item form ── */}
      {template === "item" && (
        <div style={SECTION_STYLE}>

          {/* Passive bonuses grid */}
          <div>
            <p style={{ ...LABEL_STYLE, color: "#60a5fa", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Passive Bonuses
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, paddingLeft: 8, borderLeft: "2px solid #1e2a3a" }}>
              {BONUS_FIELDS.map((field) => (
                <NumberField
                  key={field}
                  label={field}
                  value={item.bonuses[field]}
                  onChange={(n) => setBonus(field, n)}
                />
              ))}
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
                    checked={item.blockedActions.includes(action)}
                    onChange={() => toggleBlocked(action)}
                    style={{ accentColor: "#f87171" }}
                  />
                  <span style={{ fontSize: 11, color: item.blockedActions.includes(action) ? "#f87171" : "#6b7280", fontFamily: "monospace" }}>
                    {action}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Grants action toggle + action fields */}
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: 6 }}>
              <input
                type="checkbox"
                checked={item.grantsAction}
                onChange={(e) => setItem((s) => ({ ...s, grantsAction: e.target.checked }))}
                style={{ accentColor: "#60a5fa" }}
              />
              <span style={{ ...LABEL_STYLE, marginBottom: 0, color: "#60a5fa", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Grants an action
              </span>
            </label>

            {item.grantsAction && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, paddingLeft: 8, borderLeft: "2px solid #1e2a3a" }}>
                <div>
                  <p style={LABEL_STYLE}>action_name <span style={{ color: "#4b5563" }}>e.g. SWING, SPIT, CAST</span></p>
                  <input
                    type="text"
                    value={item.actionName}
                    onChange={(e) => setItem((s) => ({ ...s, actionName: e.target.value.toUpperCase() }))}
                    style={{ ...INPUT_STYLE, fontFamily: "monospace" }}
                  />
                </div>
                <NumberField
                  label="cast_time_ms"
                  hint="0 = next sub-tick · 500 = 1 sub-tick delay"
                  value={item.castTimeMs}
                  min={0}
                  onChange={(n) => setItem((s) => ({ ...s, castTimeMs: n }))}
                />
                <NumberField
                  label="targeting.count"
                  hint="tiles player must click"
                  value={item.targetingCount}
                  min={1}
                  onChange={(n) => setItem((s) => ({ ...s, targetingCount: Math.max(1, n) }))}
                />
                <NumberField
                  label="targeting.max_range"
                  hint="Chebyshev dist · 1 = adjacent only"
                  value={item.maxRange}
                  min={0}
                  onChange={(n) => setItem((s) => ({ ...s, maxRange: Math.max(0, n) }))}
                />
                <div>
                  <p style={LABEL_STYLE}>targeting.adjacency_required <span style={{ color: "#4b5563" }}>UI hint only</span></p>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={item.adjacencyRequired}
                      onChange={(e) => setItem((s) => ({ ...s, adjacencyRequired: e.target.checked }))}
                      style={{ accentColor: "#60a5fa" }}
                    />
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>require adjacency</span>
                  </label>
                </div>
              </div>
            )}
          </div>
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
