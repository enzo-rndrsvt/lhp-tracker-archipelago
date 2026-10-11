// Analyses built on the logic: which missing item unlocks the most checks, and the inventory overview
// (spells, abilities and the characters that grant them).
import { allRules, computeLogic, type Rule } from "./logic";

function walk(rule: Rule, visit: (r: Rule) => void) {
  visit(rule);
  if (rule.t === "and" || rule.t === "or") rule.r.forEach((c) => walk(c, visit));
  else if (rule.t === "group") walk(rule.r, visit);
}

function itemsOf(rule: Rule): string[] {
  const out: string[] = [];
  walk(rule, (r) => {
    if (r.t === "has") out.push(r.i);
  });
  return out;
}

/** Real items that appear somewhere in the logic (events and goal counters excluded). */
const logicItems = new Set<string>();
/** Ability group name ("Magie noire", "Force"…) -> items that grant it. */
export const abilityGroups = new Map<string, string[]>();
for (const rule of allRules) {
  walk(rule, (r) => {
    if (r.t === "has" && !/ Event Cleared$|^UNIQUE_HORCRUX$|^Voldemort Defeated$|^Level Beaten$/.test(r.i)) {
      logicItems.add(r.i);
    }
    if (r.t === "group" && !abilityGroups.has(r.g)) abilityGroups.set(r.g, [...new Set(itemsOf(r.r))]);
  });
}

/** Spells and unlockable abilities shown in the inventory (not level unlocks, characters or tokens). */
export const spellItems = [...logicItems]
  .filter((i) => / Unlocked$/.test(i) && !/: Level Unlocked$/.test(i) && !/^Score x/.test(i))
  .sort();
export const levelUnlockItems = [...logicItems].filter((i) => /: Level Unlocked$/.test(i));
export const scoreItems = [...logicItems].filter((i) => /^Score x/.test(i)).sort((a, b) => parseInt(a.slice(7)) - parseInt(b.slice(7)));

export interface UnlockRow {
  /** Items that each unlock exactly the same checks (e.g. any Dark Magic character). */
  items: string[];
  /** Location ids that become accessible. */
  gained: number[];
}

/**
 * For every logic item the player doesn't have, count the missing checks that would enter logic if they
 * received it. Items with identical effects are merged into one row. ~0.3 ms per item.
 */
export function computeUnlocks(
  received: Map<string, number>,
  slotData: Record<string, unknown>,
  slotLocations: Set<number>,
  missing: Set<number>,
  accessible: Set<number>,
): UnlockRow[] {
  const base: string[] = [];
  for (const [name, n] of received) for (let i = 0; i < n; i++) base.push(name);
  const rows = new Map<string, UnlockRow>();
  for (const item of logicItems) {
    if (received.has(item)) continue;
    const result = computeLogic([...base, item], slotData, slotLocations);
    const gained = [...result.accessible].filter((id) => missing.has(id) && !accessible.has(id));
    if (!gained.length) continue;
    const key = gained.sort((a, b) => a - b).join(",");
    const row = rows.get(key);
    if (row) row.items.push(item);
    else rows.set(key, { items: [item], gained });
  }
  return [...rows.values()].sort((a, b) => b.gained.length - a.gained.length || a.items.length - b.items.length);
}
