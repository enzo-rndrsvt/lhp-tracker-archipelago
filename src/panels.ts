// Sidebar panels: "À faire", "Priorités", "Inventaire" and "Hints".
import type { TrackerState } from "./archipelago";
import { itemLabel } from "./explain";
import { abilityGroups, levelUnlockItems, scoreItems, spellItems, type UnlockRow } from "./insights";
import { locationNameById } from "./logic";
import type { SpoilerData } from "./spoiler";

/** Network hint, as stored by the server in data storage key `_read_hints_{team}_{slot}`. */
export interface Hint {
  receiving_player: number;
  finding_player: number;
  location: number;
  item: number;
  found: boolean;
  item_flags?: number;
}

export interface PanelContext {
  tracker: TrackerState | null;
  spoiler: SpoilerData | null;
  received: Map<string, number>;
  accessible: Set<number>;
  hints: Hint[];
  /** Clickable location of this slot (status dot, jumps to its pin). */
  locationLink(location: string, text?: string): HTMLElement;
  /** Map name of the pin showing a location, if any. */
  mapOf(location: string): string | undefined;
  mapOrder: string[];
  openMap(name: string): void;
}

const GAME = "Lego Harry Potter 5-7";

// ---------- small DOM helpers ----------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function note(text: string) {
  return el("p", "panel-note", text);
}

function needsConnection(ctx: PanelContext, panel: HTMLElement): ctx is PanelContext & { tracker: TrackerState } {
  if (ctx.tracker) return true;
  panel.replaceChildren(note("Connecte-toi à la room pour voir ce panneau."));
  return false;
}

/** "📍 Sola — World Map: …" placements of an item for this slot, from the spoiler. */
function placements(ctx: PanelContext, item: string, max = 2): HTMLElement[] {
  const list = ctx.spoiler?.items[item] ?? [];
  return list.slice(0, max).map((p) =>
    p.player === ctx.spoiler!.slot
      ? ctx.locationLink(p.location, `📍 Ton monde — ${p.location}`)
      : el("div", "where", `📍 ${p.player} — ${p.location}`),
  );
}

// ---------- À faire ----------
/** Accessible checks grouped by map, in the pack's map order. */
export function renderTodo(panel: HTMLElement, ctx: PanelContext) {
  if (!needsConnection(ctx, panel)) return;
  const groups = new Map<string, string[]>();
  for (const id of ctx.tracker.missing) {
    if (!ctx.accessible.has(id)) continue;
    const name = locationNameById.get(id);
    if (!name) continue;
    const map = ctx.mapOf(name) ?? "Autres";
    if (!groups.has(map)) groups.set(map, []);
    groups.get(map)!.push(name);
  }
  if (!groups.size) {
    panel.replaceChildren(note("Rien d'accessible pour l'instant : regarde l'onglet Priorités pour savoir quoi débloquer."));
    return;
  }
  const order = (m: string) => (ctx.mapOrder.indexOf(m) + 1 || 999);
  const total = [...groups.values()].reduce((n, g) => n + g.length, 0);
  const sections = [...groups.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([map, names]) => {
      const sec = el("section", "card");
      const h = el("button", "card-title");
      h.append(el("span", "", map), el("span", "badge avail", String(names.length)));
      h.title = "Ouvrir la carte";
      h.addEventListener("click", () => ctx.openMap(map));
      sec.append(h);
      for (const n of names.sort()) {
        sec.append(ctx.locationLink(n));
        const c = ctx.spoiler?.locations?.[n];
        if (c) sec.append(el("div", "gives indent", `🎁 ${c.player === ctx.spoiler!.slot ? itemLabel(c.item) : c.item} (pour ${c.player === ctx.spoiler!.slot ? "toi" : c.player})`));
      }
      return sec;
    });
  panel.replaceChildren(note(`${total} check(s) faisable(s) maintenant, regroupés par carte.`), ...sections);
}

// ---------- Priorités ----------
export function renderPriorities(panel: HTMLElement, ctx: PanelContext, rows: UnlockRow[] | null) {
  if (!needsConnection(ctx, panel)) return;
  if (!rows) {
    panel.replaceChildren(note("Calcul en cours…"));
    return;
  }
  if (!rows.length) {
    panel.replaceChildren(note("Aucun item ne débloque de nouveau check pour l'instant."));
    return;
  }
  const cards = rows.slice(0, 25).map((row) => {
    const card = el("section", "card prio");
    const head = el("div", "prio-head");
    const title = el("span", "prio-item", itemLabel(row.items[0]));
    head.append(title, el("span", "badge avail", `+${row.gained.length}`));
    card.append(head);
    if (row.items.length > 1) {
      const alt = el("div", "panel-sub", `ou n'importe lequel parmi ${row.items.length} : `);
      alt.title = row.items.map(itemLabel).join(", ");
      alt.append(row.items.slice(1, 6).map(itemLabel).join(", ") + (row.items.length > 6 ? "…" : ""));
      card.append(alt);
    }
    // Where to get it (first placements among the equivalent items)
    let shown = 0;
    for (const item of row.items) {
      if (shown >= 3) break;
      const p = placements(ctx, item, 3 - shown);
      shown += p.length;
      if (row.items.length > 1 && p.length) card.append(el("div", "panel-sub", `${itemLabel(item)} :`));
      card.append(...p);
    }
    const details = el("details");
    details.append(el("summary", "", `Voir les ${row.gained.length} check(s) débloqué(s)`));
    for (const id of row.gained) {
      const n = locationNameById.get(id);
      if (n) details.append(ctx.locationLink(n));
    }
    card.append(details);
    return card;
  });
  panel.replaceChildren(
    note("Ce que chaque item qui te manque rendrait accessible tout de suite, du plus utile au moins utile."),
    ...cards,
  );
}

// ---------- Inventaire ----------
export function renderInventory(panel: HTMLElement, ctx: PanelContext) {
  if (!needsConnection(ctx, panel)) return;
  const has = (i: string) => (ctx.received.get(i) ?? 0) > 0;
  const chip = (label: string, ok: boolean, title = "") => {
    const c = el("span", `inv-chip ${ok ? "ok" : "missing"}`, label);
    if (title) c.title = title;
    return c;
  };
  const section = (title: string, ...children: HTMLElement[]) => {
    const sec = el("section", "card");
    sec.append(el("h3", "card-h", title), ...children);
    return sec;
  };
  const grid = (...chips: HTMLElement[]) => {
    const g = el("div", "inv-grid");
    g.append(...chips);
    return g;
  };

  const spells = grid(...spellItems.map((i) => chip(itemLabel(i), has(i), i)));

  const abilities = el("div", "inv-abilities");
  for (const [label, members] of abilityGroups) {
    // Sub-groups and hub variants (same characters + Polyjuice) would only repeat the main abilities.
    if (/multiplicateur|\(hub\)|^Perso (costaud|qui creuse)$/i.test(label)) continue;
    const owned = members.filter(has);
    const row = el("div", "inv-ability");
    row.append(chip(label, owned.length > 0, `Donné par : ${members.map(itemLabel).join(", ")}`));
    row.append(el("span", "panel-sub", owned.length ? owned.map(itemLabel).join(", ") : "aucun perso pour l'instant"));
    abilities.append(row);
  }

  const levels = levelUnlockItems
    .map((i) => ({ i, name: i.replace(/: Level Unlocked$/, "") }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const nLevels = levels.filter((l) => has(l.i)).length;

  const out = [
    section("Sorts et capacités", spells),
    section("Capacités des personnages", abilities),
    section(`Niveaux débloqués ${nLevels}/${levels.length}`, grid(...levels.map((l) => chip(l.name, has(l.i))))),
    section("Multiplicateurs de score", grid(...scoreItems.map((i) => chip(itemLabel(i), has(i))))),
  ];
  const tokens = [...ctx.received.keys()].filter((i) => / Token$/.test(i)).length;
  const chars = [...ctx.received.keys()].filter((i) => / Playable$/.test(i)).length;
  out.push(section("Collection", el("div", "panel-sub", `${chars} personnage(s) jouable(s), ${tokens} jeton(s) reçus`)));
  panel.replaceChildren(...out);
}

// ---------- Hints ----------
export function renderHints(panel: HTMLElement, ctx: PanelContext) {
  if (!needsConnection(ctx, panel)) return;
  const t = ctx.tracker;
  const player = (slot: number) => t.players.get(slot) ?? { name: `Joueur ${slot}`, game: "" };
  const star = (h: Hint) => ((h.item_flags ?? 0) & 1 ? "⭐ " : "");

  const mine = ctx.hints.filter((h) => h.receiving_player === t.slot && h.finding_player !== t.slot);
  const inWorld = ctx.hints.filter((h) => h.finding_player === t.slot);
  const byStatus = (a: Hint, b: Hint) => Number(a.found) - Number(b.found);

  const forMe = el("section", "card");
  forMe.append(el("h3", "card-h", "Où sont tes items"));
  if (!mine.length) forMe.append(el("div", "panel-sub", "Aucun hint pour l'instant."));
  for (const h of mine.sort(byStatus)) {
    const finder = player(h.finding_player);
    const row = el("div", `hint ${h.found ? "found" : ""}`);
    row.append(
      el("div", "hint-item", `${star(h)}${itemLabel(t.names.item(GAME, h.item))}${h.found ? " ✓" : ""}`),
      el("div", "where", `📍 ${finder.name} — ${t.names.location(finder.game, h.location)}`),
    );
    forMe.append(row);
  }

  const inMine = el("section", "card");
  inMine.append(el("h3", "card-h", "Ce que tes checks cachent"));
  if (!inWorld.length) inMine.append(el("div", "panel-sub", "Aucun hint sur ton monde pour l'instant."));
  for (const h of inWorld.sort(byStatus)) {
    const receiver = player(h.receiving_player);
    const loc = locationNameById.get(h.location) ?? t.names.location(GAME, h.location);
    const row = el("div", `hint ${h.found ? "found" : ""}`);
    const what = receiver.name === t.slotName ? itemLabel(t.names.item(GAME, h.item)) : t.names.item(receiver.game, h.item);
    row.append(
      el("div", "hint-item", `${star(h)}${what} pour ${receiver.name === t.slotName ? "toi" : receiver.name}`),
      ctx.locationLink(loc),
    );
    inMine.append(row);
  }
  panel.replaceChildren(
    note("Les hints demandés dans la room (!hint). ⭐ = item de progression."),
    forMe,
    inMine,
  );
}

/** Our locations that are hinted and not checked yet, to highlight their pins. */
export function hintedLocations(ctx: { tracker: TrackerState | null; hints: Hint[] }): Map<string, Hint> {
  const out = new Map<string, Hint>();
  if (!ctx.tracker) return out;
  for (const h of ctx.hints) {
    if (h.finding_player !== ctx.tracker.slot || h.found) continue;
    const name = locationNameById.get(h.location);
    if (name) out.set(name, h);
  }
  return out;
}
