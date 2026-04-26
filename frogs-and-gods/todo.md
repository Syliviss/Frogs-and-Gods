# Frogs and Gods — Project TODO

## Database & Schema
- [x] Extend drizzle/schema.ts: users with role "frog"|"god"
- [x] Add frogs table (hp, mp, attack, defense, level, xp, is_dead, userId)
- [x] Add gods table (divine_power, userId)
- [x] Add parties table (groupings of frogs)
- [x] Add party_members join table
- [x] Add loot table (12-tier rarity system)
- [x] Add encounters table (active combat state)
- [x] Add encounter_participants table
- [x] Add world_log_events table (combat log for Gods)
- [x] Generate and apply Drizzle migrations

## Validation
- [x] Create shared/game.schema.ts with Zod schemas for combat moves, party invites, god interventions

## Backend — Auth & Roles
- [x] tRPC auth.registerFrog procedure
- [x] tRPC auth.registerGod procedure
- [x] tRPC auth.me procedure (returns user + frog/god profile)
- [x] Role-differentiated login flow

## Backend — Party System
- [x] tRPC party.create procedure
- [x] tRPC party.invite procedure
- [x] tRPC party.join procedure
- [x] tRPC party.myParty procedure

## Backend — Combat Engine
- [x] Create server/engine/combatLoop.ts (damage calc, HP update, permadeath)
- [x] Create server/engine/xpDistributor.ts (isolated XP logic)
- [x] tRPC combat.startEncounter procedure
- [x] tRPC combat.submitMove procedure (emits World Log event)
- [x] tRPC combat.activeEncounters procedure (for Gods)

## Backend — WebSocket Hub
- [x] Attach WebSocket server to Express HTTP server in server/_core/index.ts
- [x] World Log broadcaster: emit on every combat turn
- [x] Intervention listener: HEAL_FROG event handler
- [x] Intervention listener: SMITE_ENEMY event handler
- [x] tRPC god.intervene procedure (HEAL_FROG | SMITE_ENEMY)

## Backend — DB Helpers
- [x] server/db.ts helpers for frogs, gods, parties, encounters, world_log

## Frontend — Global
- [x] Dark fantasy theme (index.css color palette, fonts)
- [x] App.tsx routing: /, /frog-dashboard, /god-view
- [x] Role-aware navigation

## Frontend — Landing Page
- [x] Elegant landing page with role selection (Frog vs God)
- [x] Character creation flow with name input

## Frontend — Frog Dashboard
- [x] Character stats panel (HP, MP, ATK, DEF, Level, XP bars)
- [x] Party status panel (create/view party)
- [x] Combat log display (scrolling)
- [x] Action input for submitting moves (ATTACK, MAGIC, DEFEND, FLEE)
- [x] Permadeath overlay (shown when is_dead = true)
- [x] World Log mini-feed (live WebSocket events)

## Frontend — God's View
- [x] Live World Log feed (WebSocket, 150 entries, auto-scroll)
- [x] Heal Frog intervention button (HEAL_FROG)
- [x] Smite Enemy intervention button (SMITE_ENEMY)
- [x] Divine power display with stat bar
- [x] Active encounters list (auto-refresh every 5s)
- [x] Event legend (color-coded types)

## Tests
- [x] Vitest: XP distributor (solo, party, dead frogs, level-up) — 6 tests
- [x] Vitest: combat engine (all moves, permadeath, victory, XP) — 8 tests
- [x] Vitest: Zod schema validation (CombatMove, GodIntervention, PartyInvite, Enemy) — 12 tests
- [x] Vitest: auth logout test — 1 test
- [x] Total: 27 tests passing
