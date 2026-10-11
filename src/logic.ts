// Evaluates the logic exported from the apworld (src/data/logic.json, see tools/extract_logic.py).
// Mirrors Archipelago's CollectionState sweep: regions are expanded from "Menu" through entrance
// rules, event locations are collected as soon as they are reachable, until nothing changes.
import logicData from "./data/logic.json";

export type Rule =
  | { t: "true" }
  | { t: "has"; i: string; c: number | string }
  | { t: "and" | "or"; r: Rule[] }
  | { t: "opt"; f: { o: string; v: number; op: string }[] }
  | { t: "region"; n: string }
  | { t: "location"; n: string }
  | { t: "multi"; p: number }
  | { t: "group"; g: string; r: Rule };

export interface LocationDef {
  id: number;
  region: string;
  rule: Rule;
}

interface EventDef {
  region: string;
  item: string;
  rule: Rule;
}

interface LogicData {
  regions: string[];
  entrances: { from: string; to: string; rule: Rule }[];
  locations: Record<string, LocationDef>;
  goals: Record<string, { events: Record<string, EventDef>; completion: Rule }>;
  horcruxes: string[];
  multi: { low: Rule; high: Rule };
  items: Record<string, number>;
}

const logic = logicData as unknown as LogicData;

// Defaults from the apworld's Options.py, used when slot_data lacks a value.
const OPTION_DEFAULTS: Record<string, number> = {
  EndGoal: 0,
  NumHorcruxRequired: 4,
  NumLevelsRequired: 12,
  ShuffleCharacterTokens: 0,
  ShuffleRedBricks: 0,
  ShuffleJokeSpells: 1,
  ShuffleGoldBrickPurchases: 1,
  CheaperShops: 5,
  HardPurchases: 0,
  LowMultiplierPriceMinimum: 50000,
  HighMultiplierPriceMinimum: 100000,
};

export const itemNameById = new Map<number, string>(
  Object.entries(logic.items).map(([name, id]) => [id, name]),
);
export const locationNameById = new Map<number, string>(
  Object.entries(logic.locations).map(([name, d]) => [d.id, name]),
);
export const locationIdByName = new Map<string, number>(
  Object.entries(logic.locations).map(([name, d]) => [name, d.id]),
);

const horcruxes = new Set(logic.horcruxes);

export interface LogicResult {
  accessible: Set<number>;
  regions: Set<string>;
  goalReachable: boolean;
  /** Evaluate any rule against the final state (items + collected events). */
  evaluate(rule: Rule): boolean;
  /** Option value from slot_data (or the apworld default). */
  option(name: string): number;
}

export const locationDefs = logic.locations;
/** Every rule of the world (locations, entrances, events, shop multipliers), for analysis. */
export const allRules: Rule[] = [
  ...Object.values(logic.locations).map((l) => l.rule),
  ...logic.entrances.map((e) => e.rule),
  ...Object.values(logic.goals).flatMap((g) => Object.values(g.events).map((e) => e.rule)),
  logic.multi.low,
  logic.multi.high,
];
export const multiRules = logic.multi;

/** Entrance used to first reach each region from "Menu" (the region graph is a tree, plus one loop). */
export const regionParent = new Map<string, { from: string; rule: Rule }>();
{
  const queue = ["Menu"];
  const seen = new Set(queue);
  while (queue.length) {
    const r = queue.shift()!;
    for (const e of logic.entrances) {
      if (e.from === r && !seen.has(e.to)) {
        seen.add(e.to);
        regionParent.set(e.to, { from: e.from, rule: e.rule });
        queue.push(e.to);
      }
    }
  }
}

export function computeLogic(
  receivedItems: string[],
  slotData: Record<string, unknown>,
  slotLocations: Set<number>,
): LogicResult {
  const option = (name: string): number => {
    const v = slotData[name];
    return typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : (OPTION_DEFAULTS[name] ?? 0);
  };

  const counts = new Map<string, number>();
  const give = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1);
  receivedItems.forEach(give);

  const goal = logic.goals[String(option("EndGoal"))] ?? logic.goals["0"];
  const regions = new Set<string>(["Menu"]);

  const count = (item: string): number => {
    if (item === "UNIQUE_HORCRUX") {
      let n = 0;
      for (const h of horcruxes) if ((counts.get(h) ?? 0) > 0) n++;
      return n;
    }
    return counts.get(item) ?? 0;
  };

  const evaluate = (rule: Rule, depth = 0): boolean => {
    switch (rule.t) {
      case "true":
        return true;
      case "has": {
        const need = typeof rule.c === "string" ? option(rule.c.replace(/^\$/, "")) : rule.c;
        return count(rule.i) >= need;
      }
      case "and":
        return rule.r.every((r) => evaluate(r, depth));
      case "or":
        return rule.r.some((r) => evaluate(r, depth));
      case "opt":
        return rule.f.every(({ o, v, op }) => compare(option(o), v, op));
      case "region":
        return regions.has(rule.n);
      case "location": {
        if (depth > 8) return false;
        const loc = logic.locations[rule.n];
        if (loc) {
          return slotLocations.has(loc.id) && regions.has(loc.region) && evaluate(loc.rule, depth + 1);
        }
        const ev = goal.events[rule.n];
        return !!ev && regions.has(ev.region) && evaluate(ev.rule, depth + 1);
      }
      case "group":
        return evaluate(rule.r, depth);
      case "multi": {
        const price = rule.p / option("CheaperShops");
        if (price < option("LowMultiplierPriceMinimum")) return true;
        if (price < option("HighMultiplierPriceMinimum")) return evaluate(logic.multi.low, depth);
        return evaluate(logic.multi.high, depth);
      }
    }
  };

  const collected = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of logic.entrances) {
        if (!regions.has(e.to) && regions.has(e.from) && evaluate(e.rule)) {
          regions.add(e.to);
          grew = changed = true;
        }
      }
    }
    for (const [name, ev] of Object.entries(goal.events)) {
      if (!collected.has(name) && regions.has(ev.region) && evaluate(ev.rule)) {
        collected.add(name);
        give(ev.item);
        changed = true;
      }
    }
  }

  const accessible = new Set<number>();
  for (const loc of Object.values(logic.locations)) {
    if (slotLocations.has(loc.id) && regions.has(loc.region) && evaluate(loc.rule)) accessible.add(loc.id);
  }

  return { accessible, regions, goalReachable: evaluate(goal.completion), evaluate: (r) => evaluate(r), option };
}

function compare(a: number, b: number, op: string): boolean {
  switch (op) {
    case "eq":
      return a === b;
    case "ne":
      return a !== b;
    case "gt":
      return a > b;
    case "lt":
      return a < b;
    case "ge":
      return a >= b;
    case "le":
      return a <= b;
    default:
      return false;
  }
}
