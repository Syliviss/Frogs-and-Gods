import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const [registeringAs, setRegisteringAs] = useState<"frog" | "god" | null>(null);
  const [charName, setCharName] = useState("");

  const meQuery = trpc.auth.me.useQuery(undefined, { enabled: isAuthenticated });
  const registerFrog = trpc.auth.registerFrog.useMutation({
    onSuccess: () => {
      toast.success("Your Frog has entered the swamp!");
      meQuery.refetch();
      navigate("/frog-dashboard");
    },
    onError: (e) => toast.error(e.message),
  });
  const registerGod = trpc.auth.registerGod.useMutation({
    onSuccess: () => {
      toast.success("You ascend. The World Log awaits.");
      meQuery.refetch();
      navigate("/god-view");
    },
    onError: (e) => toast.error(e.message),
  });

  const hasFrog = !!meQuery.data?.frog;
  const hasGod = !!meQuery.data?.god;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-primary text-xl animate-pulse" style={{ fontFamily: "Cinzel, serif" }}>
          Consulting the Ancients…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "radial-gradient(ellipse at 50% 0%, oklch(0.15 0.04 290 / 0.3) 0%, transparent 60%), oklch(0.10 0.015 240)" }}>
      {/* ── HEADER ── */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🐸</span>
          <span style={{ fontFamily: "Cinzel, serif", fontSize: "1.1rem", color: "var(--primary)" }}>
            Frogs &amp; Gods
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isAuthenticated ? (
            <>
              {hasFrog && (
                <Button variant="outline" size="sm" onClick={() => navigate("/frog-dashboard")}>
                  Frog Dashboard
                </Button>
              )}
              {hasGod && (
                <Button variant="outline" size="sm" onClick={() => navigate("/god-view")}>
                  God's View
                </Button>
              )}
              <span className="text-muted-foreground text-sm">{user?.name}</span>
            </>
          ) : (
            <Button size="sm" onClick={() => (window.location.href = getLoginUrl())}>
              Enter the Realm
            </Button>
          )}
        </div>
      </header>

      {/* ── HERO ── */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="text-6xl mb-4">⚔️🐸✨</div>
          <h1
            className="text-4xl md:text-5xl font-bold"
            style={{ fontFamily: "Cinzel, serif", color: "var(--primary)", textShadow: "0 0 40px oklch(0.78 0.16 80 / 0.3)" }}
          >
            Frogs &amp; Gods
          </h1>
          <p className="text-lg text-muted-foreground italic" style={{ fontFamily: "Crimson Text, serif" }}>
            "In the swamp eternal, mortals fight for glory — while immortals watch and meddle."
          </p>

          <div className="ornament-divider">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Choose Your Fate</span>
          </div>

          {!isAuthenticated ? (
            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
              <RoleCard
                emoji="🐸"
                title="Play as a Frog"
                description="Fight turn-based battles, earn loot, level up — and face permadeath."
                color="var(--xp-color)"
                onClick={() => (window.location.href = getLoginUrl())}
              />
              <RoleCard
                emoji="⚡"
                title="Ascend as a God"
                description="Watch the World Log unfold. Intervene with divine power. Shape fate."
                color="var(--divine-color)"
                onClick={() => (window.location.href = getLoginUrl())}
              />
            </div>
          ) : !hasFrog && !hasGod ? (
            <div className="space-y-6 mt-8">
              <p className="text-muted-foreground">Welcome, <strong className="text-foreground">{user?.name}</strong>. Choose your path:</p>
              {registeringAs === null ? (
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <RoleCard
                    emoji="🐸"
                    title="Become a Frog"
                    description="Enter the swamp as a mortal warrior. Fight, loot, level — or die forever."
                    color="var(--xp-color)"
                    onClick={() => setRegisteringAs("frog")}
                  />
                  <RoleCard
                    emoji="⚡"
                    title="Ascend as a God"
                    description="Observe the mortal struggle from above. Intervene at will with divine power."
                    color="var(--divine-color)"
                    onClick={() => setRegisteringAs("god")}
                  />
                </div>
              ) : (
                <div className="max-w-sm mx-auto space-y-4 p-6 rounded-lg border border-border bg-card">
                  <h3 className="text-lg font-semibold" style={{ fontFamily: "Cinzel, serif", color: "var(--primary)" }}>
                    {registeringAs === "frog" ? "Name Your Frog" : "Choose Your Divine Name"}
                  </h3>
                  <input
                    type="text"
                    placeholder={registeringAs === "frog" ? "e.g. Ribbit the Brave" : "e.g. Zephyros the Eternal"}
                    value={charName}
                    onChange={(e) => setCharName(e.target.value)}
                    className="w-full px-3 py-2 rounded border border-border bg-input text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    maxLength={64}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => { setRegisteringAs(null); setCharName(""); }}
                    >
                      Back
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={charName.trim().length < 2}
                      onClick={() => {
                        if (registeringAs === "frog") {
                          registerFrog.mutate({ characterName: charName.trim() });
                        } else {
                          registerGod.mutate({ godName: charName.trim() });
                        }
                      }}
                    >
                      {registerFrog.isPending || registerGod.isPending ? "Entering…" : "Enter the Realm"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
              {hasFrog && (
                <Button size="lg" onClick={() => navigate("/frog-dashboard")} className="glow-gold">
                  🐸 Open Frog Dashboard
                </Button>
              )}
              {hasGod && (
                <Button size="lg" variant="outline" onClick={() => navigate("/god-view")} style={{ borderColor: "var(--divine-color)", color: "var(--divine-color)" }}>
                  ⚡ Open God's View
                </Button>
              )}
            </div>
          )}
        </div>
      </main>

      {/* ── FOOTER ── */}
      <footer className="text-center py-4 text-muted-foreground text-xs border-t border-border/30">
        Frogs &amp; Gods · A Text-Based Asymmetrical JRPG
      </footer>
    </div>
  );
}

function RoleCard({
  emoji,
  title,
  description,
  color,
  onClick,
}: {
  emoji: string;
  title: string;
  description: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 max-w-xs p-6 rounded-xl border text-left transition-all duration-200 hover:scale-[1.02]"
      style={{
        borderColor: `${color}40`,
        background: `linear-gradient(135deg, oklch(0.13 0.018 240), oklch(0.11 0.015 240))`,
        boxShadow: `0 0 20px ${color}15`,
      }}
    >
      <div className="text-4xl mb-3">{emoji}</div>
      <h3 className="text-base font-semibold mb-2" style={{ fontFamily: "Cinzel, serif", color }}>
        {title}
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
    </button>
  );
}
