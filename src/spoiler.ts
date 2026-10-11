// Reads an Archipelago spoiler log (archipelago.gg/dl_spoiler/...) to tell where this slot's items are
// placed and what each of this slot's checks gives. Only the part about our slot is kept (in
// localStorage), not the whole file.

export interface ItemPlacement {
  location: string;
  /** Player whose world holds the location. */
  player: string;
}

export interface CheckContent {
  item: string;
  /** Player who receives the item. */
  player: string;
}

export interface SpoilerData {
  slot: string;
  players: string[];
  /** Item name -> where each copy of it is placed. */
  items: Record<string, ItemPlacement[]>;
  /** Our location name -> the item it gives. Missing in data saved by older versions. */
  locations?: Record<string, CheckContent>;
}

export function parseSpoiler(text: string, slot: string): SpoilerData {
  const players = [...text.matchAll(/^Player \d+: (.+)$/gm)].map((m) => m[1].trim());
  if (!players.length) throw new Error("Ce fichier ne ressemble pas à un spoiler Archipelago.");
  if (!players.includes(slot)) {
    throw new Error(`Le slot « ${slot} » n'est pas dans ce spoiler (joueurs : ${players.join(", ")}).`);
  }

  const start = text.indexOf("\nLocations:");
  const end = text.indexOf("\nPlaythrough:", start);
  const section = text.slice(start, end < 0 ? undefined : end);

  // "Location (Owner): Item (Receiver)". Names may contain parentheses, so anchor on known player names.
  const names = players.map(escapeRegExp).sort((a, b) => b.length - a.length).join("|");
  const line = new RegExp(`^(.+) \\((${names})\\): (.+) \\((${names})\\)$`);
  const items: SpoilerData["items"] = {};
  const locations: NonNullable<SpoilerData["locations"]> = {};
  for (const raw of section.split("\n")) {
    const m = raw.trim().match(line);
    if (!m) continue;
    if (m[4] === slot) (items[m[3]] ??= []).push({ location: m[1], player: m[2] });
    if (m[2] === slot) locations[m[1]] = { item: m[3], player: m[4] };
  }
  if (!Object.keys(items).length) throw new Error("Aucun item trouvé pour ce slot dans le spoiler.");
  return { slot, players, items, locations };
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
