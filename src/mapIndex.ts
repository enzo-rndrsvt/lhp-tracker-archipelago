// Port of `lhp2_map_to_tab_index` from the apworld (__init__.py): the game client writes the current
// in-game map id to data storage key "Slot:{slot}:map"; this turns it into a tab index (maps.json order).

// Raw game map ID -> hub offset (several IDs per area because of Year 5/6/7/8 variants)
const RAW_TO_HUB: Record<number, number> = {
  4: 0, 98: 0,
  5: 1, 99: 1,
  6: 2, 100: 2,
  8: 3, 103: 3, 173: 3, 276: 3,
  9: 4, 104: 4, 174: 4, 277: 4,
  11: 5, 106: 5, 176: 5,
  12: 6, 107: 6, 177: 6,
  13: 7, 108: 7, 179: 7, 280: 7,
  14: 8, 109: 8, 180: 8, 282: 8,
  15: 9, 110: 9, 181: 9, 283: 9,
  16: 10, 111: 10, 182: 10, 284: 10,
  17: 11, 112: 11, 184: 11, 285: 11,
  18: 12, 114: 12, 185: 12, 288: 12,
  19: 13, 115: 13, 186: 13, 289: 13,
  20: 14, 116: 14, 187: 14, 290: 14,
  21: 15, 117: 15, 188: 15, 292: 15,
  22: 16, 118: 16, 189: 16, 293: 16,
  23: 17,
  24: 18,
  25: 19, 119: 19, 190: 19, 295: 19,
  26: 20, 120: 20, 191: 20, 296: 20,
  27: 21, 121: 21, 192: 21,
  28: 22, 122: 22, 193: 22, 297: 22,
  29: 23, 123: 23, 194: 23, 298: 23,
  30: 24, 124: 24, 183: 24,
  31: 25, 125: 25, 195: 25,
  32: 26, 126: 26, 196: 26, 299: 26,
  33: 27, 127: 27, 197: 27,
  34: 28, 128: 28, 198: 28, 300: 28,
  35: 29, 129: 29, 199: 29, 301: 29,
  36: 30, 130: 30, 200: 30, 302: 30,
  37: 31, 131: 31, 201: 31, 303: 31,
  39: 32, 133: 32, 203: 32, 305: 32,
  40: 33, 134: 33, 204: 33,
  41: 34, 135: 34, 205: 34, 306: 34,
  366: 35, 372: 35, 378: 35, 382: 35,
  367: 36, 373: 36, 379: 36, 385: 36,
  368: 37, 374: 37, 380: 37, 386: 37,
  369: 38, 375: 38, 383: 38, 387: 38,
  370: 39, 376: 39, 384: 39, 388: 39,
};

// Hub offset -> tab index
const HUB_TO_TAB = [
  9, 10, 7, 6, 8, 12, 13, 11, 14, 17, 16, 15, 32, 30, 29, 31, 28, 21, 19, 20,
  18, 26, 25, 24, 40, 35, 34, 37, 39, 36, 38, 33, 23, 27, 22, 4, 2, 5, 3, 1,
];

/**
 * Returns the tab index for a data storage value: the hub map's tab, 0 (Level Overview) for any other
 * map id (i.e. inside a level), or null when the value is empty.
 */
export function mapValueToTab(value: unknown): number | null {
  const id = typeof value === "number" ? value : parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(id)) return null;
  const hub = RAW_TO_HUB[id];
  return hub === undefined ? 0 : HUB_TO_TAB[hub];
}
