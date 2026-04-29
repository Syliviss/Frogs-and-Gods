import { useState } from "react";
import { Link } from "wouter";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
          color: open ? "#fde68a" : "#fde68a",
          cursor: "default",
          letterSpacing: "0.05em",
          userSelect: "none",
          borderRadius: 6,
          background: open ? "#0f1929" : "#1e2a3a",
          transition: "background 0.15s",
          whiteSpace: "nowrap",
          border: "1px solid #fde68a44",
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
                color: "#fde68a",
                cursor: "pointer",
                borderBottom: "1px solid #1e2a3a",
                fontFamily: "'Cinzel', serif",
                letterSpacing: "0.04em",
                background: "#0f1929",
              }}
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

export default function TestingGround() {
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
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontFamily: "'Cinzel', serif", color: "#fde68a", margin: 0 }}>
            Frogs & Gods — Testing Ground
          </h1>
          <p style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>
            User experience testing sandbox
          </p>
        </div>

        <Tabs defaultValue="_none">
          <div style={{ display: "flex", alignItems: "center", marginBottom: 20, gap: 8 }}>
            <TabsList
              style={{
                background: "#0a1120",
                border: "1px solid #1e2a3a",
              }}
            >
              <Link href="/">
                <TabsTrigger value="_none" style={{ cursor: "pointer" }}>
                  ← Admin
                </TabsTrigger>
              </Link>
            </TabsList>
            <UxTestingDropdown />
          </div>

          <div
            style={{
              background: "#0c1525",
              border: "1px solid #1e2a3a",
              borderRadius: 10,
              padding: 20,
              minHeight: 400,
            }}
          />
        </Tabs>
      </div>
    </div>
  );
}
