interface StatBarProps {
  value: number;
  max: number;
  type: "hp" | "mp" | "xp" | "divine";
  label?: string;
  showNumbers?: boolean;
  className?: string;
}

export function StatBar({ value, max, type, label, showNumbers = true, className = "" }: StatBarProps) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const colorClass = `${type}-bar`;

  const labelMap: Record<string, string> = {
    hp: "HP",
    mp: "MP",
    xp: "XP",
    divine: "Divine Power",
  };

  return (
    <div className={`space-y-1 ${className}`}>
      {(label !== undefined || showNumbers) && (
        <div className="flex justify-between items-center text-xs" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          <span className="text-muted-foreground uppercase tracking-wider text-[10px]">
            {label ?? labelMap[type]}
          </span>
          {showNumbers && (
            <span className="text-foreground/80">
              {value} / {max}
            </span>
          )}
        </div>
      )}
      <div className={`stat-bar ${colorClass}`}>
        <div className="stat-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
