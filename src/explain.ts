// Turns logic rules into readable requirements ("Reducto + (Force ou Spectrespecs)"), simplified with
// the slot's options and marked with what the player already has.
import { locationDefs, multiRules, regionParent, type LogicResult, type Rule } from "./logic";

export type Req =
  | { k: "item"; label: string; item: string; ok: boolean }
  | { k: "group"; label: string; members: string[]; ok: boolean }
  | { k: "region"; label: string; ok: boolean }
  | { k: "all" | "any"; parts: Req[]; ok: boolean };

/** A single requirement (item, ability group or area), as opposed to an AND / OR list. */
export type Leaf = Exclude<Req, { k: "all" | "any" }>;

/** `true` = no requirement, `false` = impossible with these options. */
export type Simplified = Req | boolean;

export interface LocationRequirements {
  /** Unreachable regions on the way to the location, outermost first, with what opens each one. */
  access: { region: string; req: Simplified }[];
  rule: Simplified;
}

export function explainLocation(name: string, logic: LogicResult): LocationRequirements | null {
  const def = locationDefs[name];
  if (!def) return null;
  const access: LocationRequirements["access"] = [];
  let region: string | undefined = def.region;
  while (region && !logic.regions.has(region)) {
    const parent = regionParent.get(region);
    if (!parent) break;
    access.unshift({ region, req: simplify(parent.rule, logic) });
    region = parent.from;
  }
  return { access, rule: simplify(def.rule, logic) };
}

export function simplify(rule: Rule, logic: LogicResult): Simplified {
  switch (rule.t) {
    case "true":
      return true;
    case "opt":
      return rule.f.every(({ o, v, op }) => compare(logic.option(o), v, op));
    case "multi": {
      const price = rule.p / logic.option("CheaperShops");
      if (price < logic.option("LowMultiplierPriceMinimum")) return true;
      return simplify(price < logic.option("HighMultiplierPriceMinimum") ? multiRules.low : multiRules.high, logic);
    }
    case "has": {
      const ok = logic.evaluate(rule);
      if (rule.i === "UNIQUE_HORCRUX") {
        const n = typeof rule.c === "string" ? logic.option(rule.c.replace(/^\$/, "")) : rule.c;
        return { k: "item", label: `${n} Horcruxes différents`, item: "", ok };
      }
      const label = itemLabel(rule.i) + (typeof rule.c === "number" && rule.c > 1 ? ` ×${rule.c}` : "");
      return { k: "item", label, item: rule.i, ok };
    }
    case "group":
      return { k: "group", label: rule.g, members: hasItems(rule.r), ok: logic.evaluate(rule) };
    case "region":
      return { k: "region", label: `Accès à ${rule.n}`, ok: logic.regions.has(rule.n) };
    case "location":
      return { k: "region", label: `Faire « ${rule.n} »`, ok: logic.evaluate(rule) };
    case "and":
    case "or": {
      const isAnd = rule.t === "and";
      const parts: Req[] = [];
      for (const child of rule.r) {
        const s = simplify(child, logic);
        if (s === isAnd) continue; // neutral element
        if (s === !isAnd) return !isAnd; // absorbing element
        if (typeof s !== "boolean") {
          // Flatten nested lists of the same kind.
          if (s.k === (isAnd ? "all" : "any")) parts.push(...(s as { parts: Req[] }).parts);
          else parts.push(s);
        }
      }
      if (!parts.length) return isAnd;
      if (parts.length === 1) return parts[0];
      return {
        k: isAnd ? "all" : "any",
        parts,
        ok: isAnd ? parts.every((p) => p.ok) : parts.some((p) => p.ok),
      };
    }
  }
}

/** Missing leaves of a requirement (what the player still needs). */
export function missingLeaves(req: Simplified): Leaf[] {
  if (typeof req === "boolean" || req.ok) return [];
  if (req.k === "all" || req.k === "any") return req.parts.flatMap(missingLeaves);
  return [req as Leaf];
}

const SHORT_NAMES: Record<string, string> = {
  "Weasley Wizard Wheezes Boxes Unlocked": "Boîtes WWW",
  "Pets Unlocked": "Animagus / Pets",
  "Polyjuice Potion Unlocked": "Polynectar",
  "Invisibility Cloak Unlocked": "Cape d'invisibilité",
  "Hermione's Bag Unlocked": "Sac d'Hermione",
  "Super Strength Unlocked": "Super force (red brick)",
};

/** Human-friendly item name, close to the logic sheet's wording. */
export function itemLabel(item: string): string {
  if (SHORT_NAMES[item]) return SHORT_NAMES[item];
  let m: RegExpMatchArray | null;
  if ((m = item.match(/^(.*) Event Cleared$/))) return `📜 ${m[1]}`;
  if ((m = item.match(/^(.*): Level Unlocked$/))) return `Niveau « ${m[1]} »`;
  if ((m = item.match(/^(.*) Unlocked$/))) return m[1];
  if ((m = item.match(/^(.*) Playable$/))) return m[1];
  return item;
}

function hasItems(rule: Rule): string[] {
  if (rule.t === "has") return [rule.i];
  if (rule.t === "and" || rule.t === "or") return rule.r.flatMap(hasItems);
  if (rule.t === "group") return hasItems(rule.r);
  return [];
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
