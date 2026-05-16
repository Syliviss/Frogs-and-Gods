export const DIVINE_POWER_LIST = [
  { id: "HEAL_FROG",      name: "Heal Frog",      type: "BLESSING"       },
  { id: "SMITE_ENEMY",    name: "Smite Enemy",    type: "CURSE"          },
  { id: "SPAWN_ITEM",     name: "Spawn Item",     type: "DIVINE_ABILITY" },
  { id: "SPAWN_PREDATOR", name: "Spawn Predator", type: "DIVINE_ABILITY" },
] as const;

export type DivinePowerId = typeof DIVINE_POWER_LIST[number]["id"];
export const DIVINE_POWER_IDS = DIVINE_POWER_LIST.map((p) => p.id) as [string, ...string[]];
