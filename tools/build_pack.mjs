// Convert the Universal Tracker pack (.zip) into web assets:
//   public/maps/*.webp  - compressed map images
//   src/data/pack.json  - maps + pins (map position -> Archipelago location names)
//
// Usage: node tools/build_pack.mjs [path/to/pack.zip]
import AdmZip from "adm-zip";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const zipPath = process.argv[2] ?? fs.readdirSync(root).find((f) => f.endsWith(".zip"));
if (!zipPath) {
  console.error("No pack .zip found. Pass its path as an argument.");
  process.exit(1);
}

const zip = new AdmZip(path.resolve(root, zipPath));
const readJson = (name) => {
  const entry = zip.getEntry(name);
  if (!entry) throw new Error(`Missing ${name} in pack`);
  // PopTracker allows a BOM and trailing commas; strip both.
  const text = entry.getData().toString("utf8").replace(/^﻿/, "").replace(/,(\s*[\]}])/g, "$1");
  return JSON.parse(text);
};

const outMaps = path.join(root, "public", "maps");
fs.mkdirSync(outMaps, { recursive: true });

const maps = [];
for (const m of readJson("maps/maps.json")) {
  const base = path.basename(m.img, path.extname(m.img));
  const target = path.join(outMaps, `${base}.webp`);
  if (!fs.existsSync(target)) {
    await sharp(zip.getEntry(m.img).getData()).webp({ quality: 80, effort: 5 }).toFile(target);
    console.log(`  ${m.img} -> maps/${base}.webp`);
  }
  maps.push({ name: m.name, img: `maps/${base}.webp`, w: m.img_size[0], h: m.img_size[1], size: m.location_size ?? 32 });
}

const pins = [];
const walk = (nodes) => {
  for (const n of nodes) {
    const sections = (n.sections ?? []).map((s) => s.name);
    if (sections.length && n.map_locations?.length) {
      for (const ml of n.map_locations) {
        pins.push({ name: n.name, map: ml.map, x: ml.x, y: ml.y, shape: ml.shape ?? "rect", sections });
      }
    }
    if (n.children) walk(n.children);
  }
};
for (const file of ["locations/levels.json", "locations/hub.json"]) walk(readJson(file));

fs.mkdirSync(path.join(root, "src", "data"), { recursive: true });
fs.writeFileSync(path.join(root, "src", "data", "pack.json"), JSON.stringify({ maps, pins }));

const size = fs.readdirSync(outMaps).reduce((s, f) => s + fs.statSync(path.join(outMaps, f)).size, 0);
console.log(`Wrote ${maps.length} maps (${(size / 1e6).toFixed(1)} MB) and ${pins.length} pins`);
