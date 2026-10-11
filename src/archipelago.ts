// Minimal Archipelago network client, connected as a "Tracker" (read-only, doesn't disturb the game client).
// Protocol reference: https://github.com/ArchipelagoMW/Archipelago/blob/main/docs/network%20protocol.md

export interface NetworkItem {
  item: number;
  location: number;
  player: number;
  flags: number;
}

export interface PlayerInfo {
  name: string;
  game: string;
}

/** Item / location names of every game in the room (from the DataPackage), for hints. */
export interface NameLookup {
  item(game: string, id: number): string;
  location(game: string, id: number): string;
}

export interface TrackerState {
  slot: number;
  team: number;
  slotName: string;
  /** Slot number -> player name and game. */
  players: Map<number, PlayerInfo>;
  names: NameLookup;
  slotData: Record<string, unknown>;
  checked: Set<number>;
  missing: Set<number>;
  items: NetworkItem[];
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface Handlers {
  onStatus(status: ConnectionStatus, message?: string): void;
  onUpdate(state: TrackerState): void;
  onDataStorage(key: string, value: unknown): void;
}

const GAME = "Lego Harry Potter 5-7";

export class ArchipelagoClient {
  private ws: WebSocket | null = null;
  private state: TrackerState | null = null;
  private watchedKeys: string[] = [];
  private reconnectTimer: number | undefined;
  private reconnectDelay = 2000;
  private wanted = false;
  private host = "";
  private slotName = "";
  private password = "";
  private itemNames = new Map<string, Map<number, string>>();
  private locationNames = new Map<string, Map<number, string>>();
  private readonly names: NameLookup = {
    item: (game, id) => this.itemNames.get(game)?.get(id) ?? `Item #${id}`,
    location: (game, id) => this.locationNames.get(game)?.get(id) ?? `Location #${id}`,
  };

  constructor(private handlers: Handlers) {}

  connect(host: string, slotName: string, password: string) {
    this.disconnect();
    this.host = host.trim();
    this.slotName = slotName.trim();
    this.password = password;
    this.wanted = true;
    this.reconnectDelay = 2000;
    this.open(this.candidateUrls(this.host));
  }

  disconnect() {
    this.wanted = false;
    window.clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.state = null;
    this.handlers.onStatus("disconnected");
  }

  private candidateUrls(host: string): string[] {
    const h = host.replace(/^\/connect\s+/i, "");
    if (/^wss?:\/\//i.test(h)) return [h];
    const withPort = /:\d+$/.test(h) ? h : `${h}:38281`;
    // Pages served over https can only open secure sockets.
    return location.protocol === "https:" ? [`wss://${withPort}`] : [`wss://${withPort}`, `ws://${withPort}`];
  }

  private open(urls: string[]) {
    const [url, ...fallbacks] = urls;
    this.handlers.onStatus("connecting", url);
    let opened = false;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      opened = true;
    };
    ws.onmessage = (ev) => {
      let packets: Record<string, any>[];
      try {
        packets = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const p of packets) this.handle(p);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!opened && fallbacks.length) {
        this.open(fallbacks);
        return;
      }
      if (!this.wanted) return;
      this.handlers.onStatus("error", `Connexion perdue, nouvelle tentative dans ${this.reconnectDelay / 1000}s…`);
      this.reconnectTimer = window.setTimeout(() => this.open(this.candidateUrls(this.host)), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    };
  }

  private send(...packets: Record<string, unknown>[]) {
    this.ws?.send(JSON.stringify(packets));
  }

  private handle(p: Record<string, any>) {
    switch (p.cmd) {
      case "RoomInfo":
        this.send({
          cmd: "Connect",
          game: GAME,
          name: this.slotName,
          password: this.password || null,
          uuid: clientId(),
          version: p.version ?? { major: 0, minor: 6, build: 0, class: "Version" },
          items_handling: 0b111,
          tags: ["Tracker"],
          slot_data: true,
        });
        break;

      case "ConnectionRefused":
        this.wanted = false;
        this.handlers.onStatus("error", refusalMessage(p.errors ?? []));
        this.ws?.close();
        break;

      case "Connected": {
        const game = p.slot_info?.[String(p.slot)]?.game;
        if (game && game !== GAME) {
          this.wanted = false;
          this.handlers.onStatus("error", `Ce slot joue à ${game}, pas à Lego Harry Potter 5-7.`);
          this.ws?.close();
          return;
        }
        this.reconnectDelay = 2000;
        const players = new Map<number, PlayerInfo>();
        for (const [id, info] of Object.entries<Record<string, any>>(p.slot_info ?? {})) {
          players.set(Number(id), { name: info.name, game: info.game });
        }
        this.state = {
          slot: p.slot,
          team: p.team,
          slotName: this.slotName,
          players,
          names: this.names,
          slotData: p.slot_data ?? {},
          checked: new Set(p.checked_locations),
          missing: new Set(p.missing_locations),
          items: [],
        };
        this.handlers.onStatus("connected", `${this.slotName} (slot ${p.slot})`);
        // Names of the other games' items and locations, needed to read hints.
        this.send({ cmd: "GetDataPackage", games: [...new Set([...players.values()].map((pl) => pl.game))] });
        this.handlers.onUpdate(this.state);
        if (this.watchedKeys.length) this.watchStorage(this.watchedKeys);
        break;
      }

      case "DataPackage":
        for (const [game, data] of Object.entries<Record<string, any>>(p.data?.games ?? {})) {
          this.itemNames.set(game, invert(data.item_name_to_id ?? {}));
          this.locationNames.set(game, invert(data.location_name_to_id ?? {}));
        }
        if (this.state) this.handlers.onUpdate(this.state);
        break;

      case "ReceivedItems":
        if (!this.state) return;
        if (p.index === 0) this.state.items = [];
        else if (p.index !== this.state.items.length) {
          // Out of sync: ask the server for a full resend.
          this.send({ cmd: "Sync" });
          return;
        }
        this.state.items.push(...p.items);
        this.handlers.onUpdate(this.state);
        break;

      case "RoomUpdate":
        if (!this.state || !p.checked_locations) return;
        for (const id of p.checked_locations) {
          this.state.checked.add(id);
          this.state.missing.delete(id);
        }
        this.handlers.onUpdate(this.state);
        break;

      case "Retrieved":
        for (const [k, v] of Object.entries(p.keys ?? {})) this.handlers.onDataStorage(k, v);
        break;

      case "SetReply":
        this.handlers.onDataStorage(p.key, p.value);
        break;
    }
  }

  /** Subscribe to data storage keys. `{slot}` / `{team}` are substituted once connected. */
  watchStorage(keys: string[]) {
    this.watchedKeys = keys;
    if (!this.state) return;
    const resolved = keys.map((k) =>
      k.replace("{slot}", String(this.state!.slot)).replace("{team}", String(this.state!.team)),
    );
    this.send({ cmd: "Get", keys: resolved }, { cmd: "SetNotify", keys: resolved });
  }
}

function invert(byName: Record<string, number>): Map<number, string> {
  return new Map(Object.entries(byName).map(([name, id]) => [id, name]));
}

function clientId(): string {
  const key = "ap-tracker-uuid";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function refusalMessage(errors: string[]): string {
  const known: Record<string, string> = {
    InvalidSlot: "Nom de slot introuvable dans cette room.",
    InvalidGame: "Ce slot ne joue pas à Lego Harry Potter 5-7.",
    InvalidPassword: "Mot de passe incorrect.",
    IncompatibleVersion: "Version du serveur incompatible.",
    InvalidItemsHandling: "Paramètres de connexion refusés par le serveur.",
  };
  return errors.map((e) => known[e] ?? e).join(" ") || "Connexion refusée.";
}
