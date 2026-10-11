import "./style.css";
import packData from "./data/pack.json";
import { ArchipelagoClient, type ConnectionStatus, type TrackerState } from "./archipelago";
import { computeLogic, itemNameById, locationIdByName, type LogicResult } from "./logic";
import { explainLocation, itemLabel, missingLeaves, type Leaf, type Simplified } from "./explain";
import { computeUnlocks, type UnlockRow } from "./insights";
import { mapValueToTab } from "./mapIndex";
import {
  hintedLocations,
  renderHints,
  renderInventory,
  renderPriorities,
  renderTodo,
  type Hint,
  type PanelContext,
} from "./panels";
import { parseSpoiler, type SpoilerData } from "./spoiler";
import { MapViewer } from "./viewer";

export interface MapDef {
  name: string;
  img: string;
  w: number;
  h: number;
  size: number;
}

export interface PinDef {
  name: string;
  map: string;
  x: number;
  y: number;
  shape: string;
  sections: string[];
}

type PinStatus = "all" | "some" | "none" | "done" | "idle";

const pack = packData as { maps: MapDef[]; pins: PinDef[] };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Persistent settings ----------
const store = {
  get(key: string, fallback = ""): string {
    try {
      return localStorage.getItem(`lhp57:${key}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(`lhp57:${key}`, value);
    } catch {
      /* storage unavailable */
    }
  },
};

// ---------- State ----------
let tracker: TrackerState | null = null;
let logic: LogicResult | null = null;
let currentMap = clampMap(Number(store.get("map", "0")));
let playerMap: number | null = null;
let selectedPin: PinDef | null = null;
let spoiler: SpoilerData | null = null;
/** Item name -> how many copies this slot has received. */
let received = new Map<string, number>();
let hints: Hint[] = [];
let hinted = new Map<string, Hint>();
let unlockRows: UnlockRow[] | null = null;
type Tab = "maps" | "todo" | "prio" | "inv" | "hints";
let activeTab: Tab = (["maps", "todo", "prio", "inv", "hints"] as const).find((t) => t === store.get("tab")) ?? "maps";

function clampMap(i: number) {
  return Number.isInteger(i) && i >= 0 && i < pack.maps.length ? i : 0;
}

const pinsByMap = new Map<string, PinDef[]>();
for (const p of pack.pins) {
  if (!pinsByMap.has(p.map)) pinsByMap.set(p.map, []);
  pinsByMap.get(p.map)!.push(p);
}

// ---------- DOM ----------
const hostInput = $<HTMLInputElement>("host");
const slotInput = $<HTMLInputElement>("slot");
const passInput = $<HTMLInputElement>("password");
const connectBtn = $<HTMLButtonElement>("connect-btn");
const statusDot = $("status");
const followBox = $<HTMLInputElement>("follow");
const hideDoneBox = $<HTMLInputElement>("hide-done");
const mapFilter = $<HTMLInputElement>("map-filter");
const mapList = $("map-list");
const popover = $("popover");
const hint = $("hint");
const sidebar = $("sidebar");

const params = new URLSearchParams(location.search);
hostInput.value = params.get("host") ?? store.get("host", "archipelago.gg:58927");
slotInput.value = params.get("slot") ?? store.get("slot", "Kapette");
followBox.checked = store.get("follow", "1") === "1";
hideDoneBox.checked = store.get("hideDone", "0") === "1";

const viewer = new MapViewer($("stage"), $("canvas"), $<HTMLImageElement>("map-img"), $("pins"));

// ---------- Status helpers ----------
function locationStatus(name: string): "done" | "avail" | "locked" | null {
  if (!tracker) return null;
  const id = locationIdByName.get(name);
  if (id === undefined) return null;
  if (tracker.checked.has(id)) return "done";
  if (!tracker.missing.has(id)) return null; // not part of this slot
  return logic?.accessible.has(id) ? "avail" : "locked";
}

function pinStatus(pin: PinDef): { status: PinStatus; remaining: number; inSlot: number } {
  if (!tracker) return { status: "idle", remaining: pin.sections.length, inSlot: pin.sections.length };
  let remaining = 0;
  let avail = 0;
  let inSlot = 0;
  for (const s of pin.sections) {
    const st = locationStatus(s);
    if (!st) continue;
    inSlot++;
    if (st !== "done") remaining++;
    if (st === "avail") avail++;
  }
  const status: PinStatus =
    remaining === 0 ? "done" : avail === remaining ? "all" : avail > 0 ? "some" : "none";
  return { status, remaining, inSlot };
}

function mapCounts(map: MapDef) {
  const seen = new Set<string>();
  let remaining = 0;
  let avail = 0;
  for (const pin of pinsByMap.get(map.name) ?? []) {
    for (const s of pin.sections) {
      if (seen.has(s)) continue;
      seen.add(s);
      const st = locationStatus(s);
      if (st === "avail" || st === "locked") remaining++;
      if (st === "avail") avail++;
    }
  }
  return { remaining, avail };
}

// ---------- Rendering ----------
function renderMapList() {
  const filter = mapFilter.value.trim().toLowerCase();
  mapList.replaceChildren(
    ...pack.maps.flatMap((m, i) => {
      if (filter && !m.name.toLowerCase().includes(filter)) return [];
      const { remaining, avail } = mapCounts(m);
      const btn = document.createElement("button");
      btn.className = "map-item";
      btn.classList.toggle("active", i === currentMap);
      btn.classList.toggle("current", i === playerMap);
      btn.classList.toggle("cleared", !!tracker && remaining === 0);
      btn.title = m.name;
      const name = document.createElement("span");
      name.className = "map-name";
      name.textContent = m.name;
      btn.append(name);
      if (tracker) {
        const badge = document.createElement("span");
        badge.className = "badge" + (avail ? " avail" : "");
        badge.textContent = remaining ? `${avail}/${remaining}` : "✓";
        badge.title = `${avail} accessible(s) sur ${remaining} restant(s)`;
        btn.append(badge);
      }
      btn.addEventListener("click", () => {
        showMap(i);
        sidebar.classList.remove("open");
      });
      return [btn];
    }),
  );
}

function renderPins() {
  const map = pack.maps[currentMap];
  viewer.renderPins(pinsByMap.get(map.name) ?? [], map, (pin, el) => {
    const { status, remaining, inSlot } = pinStatus(pin);
    el.className = `pin s-${status}` + (pin.shape === "diamond" ? " diamond" : "");
    el.classList.toggle("hidden", inSlot === 0 || (hideDoneBox.checked && status === "done"));
    el.classList.toggle("selected", pin === selectedPin);
    el.classList.toggle("hinted", status !== "done" && pin.sections.some((s) => hinted.has(s)));
    el.firstElementChild!.textContent = remaining > 1 ? String(remaining) : "";
    el.title = pin.name;
  });
  if (selectedPin) renderPopover();
}

function renderStats() {
  const stats = $("stats");
  stats.hidden = !tracker;
  if (!tracker) return;
  let avail = 0;
  for (const id of tracker.missing) if (logic?.accessible.has(id)) avail++;
  $("stat-checked").textContent = String(tracker.checked.size);
  $("stat-avail").textContent = String(avail);
  $("stat-total").textContent = String(tracker.checked.size + tracker.missing.size);
  $("stat-goal").classList.toggle("reachable", !!logic?.goalReachable);
}

function renderPopover() {
  const pin = selectedPin;
  if (!pin) {
    popover.hidden = true;
    return;
  }
  const head = document.createElement("h2");
  head.textContent = pin.name;
  const close = document.createElement("button");
  close.className = "close";
  close.textContent = "✕";
  close.setAttribute("aria-label", "Fermer");
  close.addEventListener("click", () => selectPin(null));
  const ul = document.createElement("ul");
  const cls = { done: "s-done", avail: "s-all", locked: "s-none", idle: "s-idle" } as const;
  for (const s of pin.sections) {
    const st = tracker ? locationStatus(s) : "idle";
    if (!st) continue;
    const li = document.createElement("li");
    if (st === "done") li.className = "done";
    if (hinted.has(s)) li.classList.add("hinted");
    const dot = document.createElement("i");
    dot.className = `dot ${cls[st]}`;
    const body = document.createElement("div");
    body.className = "loc";
    const label = document.createElement("span");
    label.textContent = s;
    body.append(label);
    const gives = checkContent(s);
    if (gives) body.append(gives);
    else if (hinted.has(s) && tracker) {
      const h = hinted.get(s)!;
      const who = tracker.players.get(h.receiving_player);
      const hint = document.createElement("div");
      hint.className = "hint-line";
      hint.textContent = `Hint : ${who ? tracker.names.item(who.game, h.item) : "un item"} pour ${who?.name === tracker.slotName ? "toi" : (who?.name ?? "?")}`;
      body.append(hint);
    }
    if (st === "avail" || st === "locked") {
      const reqs = requirementsBlock(s);
      if (reqs) body.append(reqs);
    }
    li.append(dot, body);
    ul.append(li);
  }
  popover.replaceChildren(close, head, ul);
  popover.hidden = false;
  viewer.placePopover(popover, pin);
}

/** "🎁 Reducto (pour toi)": the item a check gives, from the spoiler. */
function checkContent(location: string): HTMLElement | null {
  const c = spoiler?.locations?.[location];
  if (!c) return null;
  const el = document.createElement("div");
  el.className = "gives";
  const mine = c.player === spoiler!.slot;
  el.textContent = `🎁 ${mine ? itemLabel(c.item) : c.item} ${mine ? "(pour toi)" : `(pour ${c.player})`}`;
  return el;
}

// ---------- Requirements ("how do I get this?") ----------
function requirementsBlock(location: string): HTMLElement | null {
  if (!logic) return null;
  const info = explainLocation(location, logic);
  if (!info) return null;
  const box = document.createElement("div");
  box.className = "reqs";
  const line = (title: string, req: Simplified) => {
    const row = document.createElement("div");
    const k = document.createElement("span");
    k.className = "req-k";
    k.textContent = title;
    row.append(k, renderReq(req, true));
    box.append(row);
  };
  for (const a of info.access) line(`Accès « ${a.region} » :`, a.req);
  if (info.rule !== true || !info.access.length) line("Il faut :", info.rule);

  // Where the missing items are, from the spoiler.
  if (spoiler) {
    const leaves = [...info.access.map((a) => a.req), info.rule].flatMap(missingLeaves);
    const seen = new Set<string>();
    for (const leaf of leaves) {
      if (seen.has(leaf.label)) continue;
      seen.add(leaf.label);
      const where = whereToFind(leaf);
      if (!where) continue;
      const row = document.createElement("div");
      row.className = "where";
      row.textContent = `📍 ${leaf.label} : ${where}`;
      box.append(row);
    }
  }
  return box;
}

function renderReq(req: Simplified, top = false): Node {
  if (req === true) return text("rien de spécial");
  if (req === false) return text("impossible avec les options de ce slot");
  if (req.k === "all" || req.k === "any") {
    const frag = document.createDocumentFragment();
    const wrap = req.k === "any" && !top;
    if (wrap) frag.append(text("("));
    req.parts.forEach((p, i) => {
      if (i) frag.append(text(req.k === "all" ? " + " : " ou "));
      frag.append(renderReq(p));
    });
    if (wrap) frag.append(text(")"));
    return frag;
  }
  const leaf = req as Leaf;
  const chip = document.createElement("span");
  chip.className = `req ${leaf.ok ? "ok" : "missing"}`;
  chip.textContent = (leaf.ok ? "✓ " : "✗ ") + leaf.label;
  if (leaf.k === "group") chip.title = leaf.members.map(itemLabel).join(", ");
  return chip;
}

/** "Sola — World Map: …" for a missing item (or the first characters of a missing group). */
function whereToFind(leaf: Leaf): string | null {
  if (!spoiler) return null;
  const describe = (item: string) =>
    spoiler!.items[item]?.map((p) => (p.player === spoiler!.slot ? `ton monde — ${p.location}` : `${p.player} — ${p.location}`));
  if (leaf.k === "item" && leaf.item) return describe(leaf.item)?.slice(0, 2).join(" · ") ?? null;
  if (leaf.k === "group") {
    const options = leaf.members
      .map((m) => ({ m, where: describe(m)?.[0] }))
      .filter((o): o is { m: string; where: string } => !!o.where)
      .slice(0, 3);
    return options.length ? options.map((o) => `${itemLabel(o.m)} (${o.where})`).join(" · ") : null;
  }
  return null;
}

function text(s: string) {
  return document.createTextNode(s);
}

// ---------- Spoiler ----------
const spoilerStatus = $("spoiler-status");
const spoilerClear = $("spoiler-clear");

function spoilerKey() {
  return `spoiler:${slotInput.value.trim()}`;
}

function loadStoredSpoiler() {
  try {
    const raw = store.get(spoilerKey());
    spoiler = raw ? (JSON.parse(raw) as SpoilerData) : null;
  } catch {
    spoiler = null;
  }
  renderSpoilerStatus();
}

function renderSpoilerStatus() {
  spoilerStatus.textContent = !spoiler
    ? ""
    : spoiler.locations
      ? `Spoiler chargé (${spoiler.slot})`
      : "Spoiler à recharger pour voir le contenu des checks";
  spoilerClear.hidden = !spoiler;
}

async function importSpoiler(file: File) {
  try {
    spoiler = parseSpoiler(await file.text(), slotInput.value.trim());
    store.set(spoilerKey(), JSON.stringify(spoiler));
  } catch (e) {
    alert((e as Error).message);
  }
  renderSpoilerStatus();
  renderItemSearch();
  renderPanels();
  if (selectedPin) renderPopover();
}

$<HTMLInputElement>("spoiler-file").addEventListener("change", (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void importSpoiler(f);
});
spoilerClear.addEventListener("click", () => {
  spoiler = null;
  store.set(spoilerKey(), "");
  renderSpoilerStatus();
  renderItemSearch();
  renderPanels();
  if (selectedPin) renderPopover();
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f && /\.(txt|log)$/i.test(f.name)) void importSpoiler(f);
});
slotInput.addEventListener("change", loadStoredSpoiler);

function selectPin(pin: PinDef | null) {
  selectedPin = pin;
  renderPins();
  if (!pin) popover.hidden = true;
}

function showMap(i: number) {
  i = clampMap(i);
  if (i !== currentMap) selectPin(null);
  currentMap = i;
  store.set("map", String(i));
  const map = pack.maps[i];
  $("map-title").textContent = map.name;
  viewer.setMap(map, true);
  renderPins();
  renderMapList();
}

function refreshAll() {
  received = new Map();
  if (tracker) {
    const names = tracker.items.map((it) => itemNameById.get(it.item)).filter((n): n is string => !!n);
    for (const n of names) received.set(n, (received.get(n) ?? 0) + 1);
    const slotLocations = new Set([...tracker.checked, ...tracker.missing]);
    logic = computeLogic(names, tracker.slotData, slotLocations);
  } else {
    logic = null;
  }
  hinted = hintedLocations({ tracker, hints });
  unlockRows = null;
  renderStats();
  renderPins();
  renderMapList();
  renderItemSearch();
  renderPanels();
}

// ---------- Sidebar tabs & panels ----------
const panels = document.querySelectorAll<HTMLElement>(".panel[data-panel]");
const tabButtons = document.querySelectorAll<HTMLButtonElement>(".tabs [data-tab]");
tabButtons.forEach((b) =>
  b.addEventListener("click", () => {
    activeTab = b.dataset.tab as Tab;
    store.set("tab", activeTab);
    itemSearch.value = "";
    renderItemSearch();
    renderPanels();
  }),
);

function panelContext(): PanelContext {
  return {
    tracker,
    spoiler,
    received,
    accessible: logic?.accessible ?? new Set(),
    hints,
    locationLink,
    mapOf: (loc) => pinByLocation.get(loc)?.map,
    mapOrder: pack.maps.map((m) => m.name),
    openMap: (name) => {
      showMap(pack.maps.findIndex((m) => m.name === name));
      sidebar.classList.remove("open");
    },
  };
}

let unlockTimer: number | undefined;
function renderPanels() {
  const searching = itemSearch.value.trim().length > 0;
  tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === activeTab && !searching));
  panels.forEach((p) => (p.hidden = searching || p.dataset.panel !== activeTab));
  if (searching) return;
  const ctx = panelContext();
  if (activeTab === "todo") renderTodo($("todo-panel"), ctx);
  if (activeTab === "inv") renderInventory($("inv-panel"), ctx);
  if (activeTab === "hints") renderHints($("hints-panel"), ctx);
  if (activeTab === "prio") {
    renderPriorities($("prio-panel"), ctx, unlockRows);
    if (!unlockRows && tracker && logic) {
      // ~100 logic runs: do it off the input event, once bursts of updates have settled.
      window.clearTimeout(unlockTimer);
      unlockTimer = window.setTimeout(() => {
        if (!tracker || !logic) return;
        const slotLocations = new Set([...tracker.checked, ...tracker.missing]);
        unlockRows = computeUnlocks(received, tracker.slotData, slotLocations, tracker.missing, logic.accessible);
        if (activeTab === "prio") renderPriorities($("prio-panel"), panelContext(), unlockRows);
      }, 150);
    }
  }
}

// ---------- Item search ----------
const itemSearch = $<HTMLInputElement>("item-search");
const itemResults = $("item-results");
const lhpItems = new Set(itemNameById.values());

/** First pin showing each location, to jump to it from search results. */
const pinByLocation = new Map<string, PinDef>();
for (const pin of pack.pins) for (const s of pin.sections) if (!pinByLocation.has(s)) pinByLocation.set(s, pin);

function renderItemSearch() {
  const q = itemSearch.value.trim().toLowerCase();
  const searching = q.length > 0;
  itemResults.hidden = !searching;
  if (!searching) return;

  const names = new Set<string>(lhpItems);
  if (spoiler) {
    for (const n of Object.keys(spoiler.items)) names.add(n);
    for (const c of Object.values(spoiler.locations ?? {})) names.add(c.item);
  }
  const display = (n: string) => (lhpItems.has(n) ? itemLabel(n) : n);
  // Logic-only events (lessons, "Level Beaten" tokens of the goal…) aren't real items.
  const isEvent = (n: string) => / Event Cleared$|^Level Beaten$|^Voldemort Defeated$|^All Required Levels Beaten$/.test(n);
  const matches = [...names]
    .filter((n) => !isEvent(n) && (n.toLowerCase().includes(q) || display(n).toLowerCase().includes(q)))
    .sort((a, b) => {
      const sa = display(a).toLowerCase().startsWith(q) ? 0 : 1;
      const sb = display(b).toLowerCase().startsWith(q) ? 0 : 1;
      return sa - sb || display(a).localeCompare(display(b));
    });

  const cards: HTMLElement[] = [];
  for (const name of matches.slice(0, 40)) {
    const card = document.createElement("section");
    card.className = "item-card";
    const h = document.createElement("h3");
    h.textContent = display(name);
    if (display(name) !== name) h.title = name;
    card.append(h);

    if (lhpItems.has(name)) {
      const n = received.get(name) ?? 0;
      const status = document.createElement("div");
      status.className = n ? "got" : "not-got";
      status.textContent = !tracker ? "Connecte-toi pour savoir si tu l'as" : n ? `✓ Reçu${n > 1 ? ` ×${n}` : ""}` : "✗ Pas encore reçu";
      card.append(status);
    }

    // Where the copies for this slot are
    for (const p of (spoiler?.items[name] ?? []).slice(0, 6)) {
      card.append(p.player === spoiler!.slot
        ? locationLink(p.location, `📍 Ton monde — ${p.location}`)
        : line(`📍 ${p.player} — ${p.location}`));
    }
    // Copies sitting in this slot's world for other players
    for (const [loc, c] of Object.entries(spoiler?.locations ?? {})) {
      if (c.item === name && c.player !== spoiler!.slot) card.append(locationLink(loc, `🎁 Pour ${c.player} — ${loc}`));
    }
    if (!spoiler && lhpItems.has(name)) card.append(line("Charge le spoiler pour savoir où il se trouve.", "muted"));
    cards.push(card);
  }
  if (!cards.length) cards.push(line("Aucun item ne correspond.", "muted"));
  else if (matches.length > 40) cards.push(line(`… et ${matches.length - 40} autres, précise ta recherche.`, "muted"));
  itemResults.replaceChildren(...cards);
}

function line(text: string, cls = "where") {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  return el;
}

/** Clickable location of this slot: status dot + jumps to its pin. */
function locationLink(location: string, text = location) {
  const btn = document.createElement("button");
  btn.className = "loc-link";
  const st = locationStatus(location);
  const dot = document.createElement("i");
  dot.className = `dot ${st === "done" ? "s-done" : st === "avail" ? "s-all" : st === "locked" ? "s-none" : "s-idle"}`;
  const label = document.createElement("span");
  label.textContent = text;
  btn.append(dot, label);
  const pin = pinByLocation.get(location);
  btn.disabled = !pin;
  btn.title = pin ? "Voir sur la carte" : "Pas de pastille pour ce check";
  btn.addEventListener("click", () => {
    if (!pin) return;
    showMap(pack.maps.findIndex((m) => m.name === pin.map));
    viewer.focusOn(pin.x, pin.y);
    selectPin(pin);
    sidebar.classList.remove("open");
  });
  return btn;
}

itemSearch.addEventListener("input", () => {
  renderItemSearch();
  renderPanels();
});

// ---------- Archipelago ----------
const statusLabels: Record<ConnectionStatus, string> = {
  disconnected: "Déconnecté",
  connecting: "Connexion…",
  connected: "Connecté",
  error: "Erreur",
};

let refreshQueued = false;
const client = new ArchipelagoClient({
  onStatus(status, message) {
    statusDot.dataset.status = status;
    statusDot.title = message ? `${statusLabels[status]} — ${message}` : statusLabels[status];
    connectBtn.textContent = status === "disconnected" || status === "error" ? "Connexion" : "Déconnexion";
    connectBtn.classList.toggle("secondary", status === "connected" || status === "connecting");
    if (status === "error" && message) {
      hint.textContent = message;
      hint.hidden = false;
    } else if (status === "connecting") {
      hint.textContent = "Connexion au serveur…";
      hint.hidden = false;
    } else if (status === "connected") {
      hint.hidden = true;
    } else if (status === "disconnected") {
      tracker = null;
      hints = [];
      playerMap = null;
      hint.textContent = "Connecte-toi à la room pour voir tes checks en direct.";
      hint.hidden = false;
      refreshAll();
    }
  },
  onUpdate(state) {
    tracker = state;
    // Batch bursts of packets (e.g. a release) into one logic pass. setTimeout rather than
    // requestAnimationFrame so background tabs (e.g. an OBS browser source) keep updating.
    if (refreshQueued) return;
    refreshQueued = true;
    setTimeout(() => {
      refreshQueued = false;
      refreshAll();
    }, 50);
  },
  onDataStorage(key, value) {
    if (key.startsWith("_read_hints_")) {
      hints = Array.isArray(value) ? (value as Hint[]) : [];
      hinted = hintedLocations({ tracker, hints });
      renderPins();
      renderPanels();
      return;
    }
    const tab = mapValueToTab(value);
    if (tab === null) return;
    playerMap = tab;
    if (followBox.checked && tab !== currentMap) showMap(tab);
    else renderMapList();
  },
});
// The game client writes the current in-game map id here (see mapIndex.ts).
// Hints of this slot are kept by the server in "_read_hints_{team}_{slot}".
client.watchStorage(["Slot:{slot}:map", "_read_hints_{team}_{slot}"]);

$<HTMLFormElement>("connect-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (statusDot.dataset.status === "connected" || statusDot.dataset.status === "connecting") {
    client.disconnect();
    return;
  }
  store.set("host", hostInput.value.trim());
  store.set("slot", slotInput.value.trim());
  client.connect(hostInput.value, slotInput.value, passInput.value);
});

// ---------- Controls ----------
followBox.addEventListener("change", () => {
  store.set("follow", followBox.checked ? "1" : "0");
  if (followBox.checked && playerMap !== null) showMap(playerMap);
});
hideDoneBox.addEventListener("change", () => {
  store.set("hideDone", hideDoneBox.checked ? "1" : "0");
  renderPins();
});
mapFilter.addEventListener("input", renderMapList);
$("menu-toggle").addEventListener("click", () => sidebar.classList.toggle("open"));
$("zoom-in").addEventListener("click", () => viewer.zoomBy(1.4));
$("zoom-out").addEventListener("click", () => viewer.zoomBy(1 / 1.4));
$("zoom-fit").addEventListener("click", () => viewer.fit());

viewer.onPinClick = (pin) => selectPin(pin === selectedPin ? null : pin);
viewer.onBackgroundClick = () => selectPin(null);
viewer.onViewChange = () => {
  if (selectedPin) viewer.placePopover(popover, selectedPin);
};

document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "Escape") selectPin(null);
  if (e.key === "ArrowRight") showMap((currentMap + 1) % pack.maps.length);
  if (e.key === "ArrowLeft") showMap((currentMap - 1 + pack.maps.length) % pack.maps.length);
});

showMap(currentMap);
refreshAll();
loadStoredSpoiler();

if (params.get("autoconnect") === "1" && hostInput.value && slotInput.value) {
  client.connect(hostInput.value, slotInput.value, passInput.value);
}
