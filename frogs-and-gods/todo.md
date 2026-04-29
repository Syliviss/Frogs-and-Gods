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
- [x] tRPC combat.action procedure (process moves)
- [x] World intervention listener: SMITE_ENEMY event handler
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
- [x] Vitest: XP distributor (solo, party, dead frogs, overflow)

## Prototype Testing & Backend Harness
- [ ] 1. Combat Test Harness (`Admin.tsx`)
  - [ ] Add form inputs to manually spawn specific test enemies.
  - [ ] Add controls to force-initiate the combat loop between a selected Frog and Enemy.
  - [ ] Add manual TRPC mutation triggers to grant raw XP to parties to verify `xpDistributor.ts` calculations.
- [ ] 2. Visualizing the World Log
  - [ ] Implement a scrolling text container to parse and display real-time WebSocket streams from `useWorldLog.ts`.
  - [ ] Format the output to cleanly display `combatLoop.ts` events as they happen without requiring database polling.
- [ ] 3. Player Role Views
  - [ ] Create an admin quick-toggle to instantly swap the UI between the Frog's context (stats, HP/MP) and the God's context (divine power).
  - [ ] Ensure TRPC headers update automatically when the role context is switched.
- [ ] 4. Mock Authentication
  - [ ] Create a local bypass for `useAuth.ts` to allow instant session initialization.
  - [ ] Add quick-login buttons for "Test Frog" and "Test God" profiles to speed up multi-player interaction testing without going through the landing page flow.