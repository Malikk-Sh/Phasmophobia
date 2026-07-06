#!/usr/bin/env node
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = join(ROOT, '.cache', 'audio-downloads');
const OUT = join(ROOT, 'assets', 'audio', 'cc0');
const MANIFEST = join(ROOT, 'assets', 'audio', 'manifest.json');

const PACKS = [
  {
    name: '100 CC0 SFX #2',
    author: 'rubberduck',
    license: 'CC0-1.0',
    page: 'https://opengameart.org/content/100-cc0-sfx-2',
    url: 'https://opengameart.org/sites/default/files/sfx_100_v2.zip',
  },
  {
    name: '100 CC0 metal and wood SFX',
    author: 'rubberduck',
    license: 'CC0-1.0',
    page: 'https://opengameart.org/content/100-cc0-metal-and-wood-sfx',
    url: 'https://opengameart.org/sites/default/files/100-CC0-wood-metal-SFX.zip',
  },
  {
    name: 'Dark Ambiences',
    author: 'Ogrebane',
    license: 'CC0-1.0',
    page: 'https://opengameart.org/content/dark-ambiences',
    url: 'https://opengameart.org/sites/default/files/dark_ambiences.zip',
  },
];

const RULES = [
  { key: 'ambience.indoor', max: 2, any: ['ambient', 'ambience', 'dark'] },
  { key: 'ambience.basement', max: 2, any: ['ambient', 'ambience', 'dark', 'machine'] },
  { key: 'ambience.wind', max: 1, any: ['air', 'wind', 'flow'] },
  { key: 'weather.thunder', max: 2, any: ['thunder'] },
  { key: 'player.step.indoor', max: 4, any: ['footstep', 'step'], avoid: ['stone', 'snow', 'water'] },
  { key: 'player.step.outdoor', max: 4, any: ['footstep', 'step', 'stone'] },
  { key: 'door.creak', max: 3, any: ['door'], avoid: ['slam', 'close'] },
  { key: 'door.slam', max: 2, any: ['slam', 'close'] },
  { key: 'switch.click', max: 3, any: ['switch', 'click'] },
  { key: 'breaker.on', max: 1, any: ['switch', 'metal'] },
  { key: 'breaker.off', max: 1, any: ['switch', 'metal'] },
  { key: 'house.creak', max: 3, any: ['creak', 'squeak', 'wood'] },
  { key: 'prop.whoosh', max: 2, any: ['whoosh', 'woosh', 'swish', 'air'] },
  { key: 'prop.impact.hard', max: 4, any: ['metal', 'hit', 'impact', 'glass'] },
  { key: 'prop.impact.soft', max: 4, any: ['wood', 'hit', 'stone'] },
  { key: 'item.cameraPlace', max: 2, any: ['item', 'set', 'metal'] },
  { key: 'ui.click', max: 2, any: ['click', 'switch'] },
];

function rel(path) {
  return path.slice(ROOT.length).replaceAll('\\', '/');
}

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Download failed ${response.status}: ${url}`);
  await pipeline(response.body, createWriteStream(dest));
}

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...await walk(path));
    else if (['.ogg', '.mp3', '.wav'].includes(extname(ent.name).toLowerCase())) out.push(path);
  }
  return out;
}

function matches(file, rule) {
  const name = basename(file).toLowerCase();
  if (rule.avoid?.some(word => name.includes(word))) return false;
  return rule.any.some(word => name.includes(word));
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const extractedDirs = [];
  for (const pack of PACKS) {
    const zip = join(CACHE, basename(new URL(pack.url).pathname));
    const extractDir = join(CACHE, basename(zip, '.zip'));
    if (!existsSync(zip)) {
      console.log(`Downloading ${pack.name}...`);
      await download(pack.url, zip);
    }
    await rm(extractDir, { recursive: true, force: true });
    await mkdir(extractDir, { recursive: true });
    await execFileAsync('unzip', ['-q', '-o', zip, '-d', extractDir]);
    extractedDirs.push(extractDir);
  }

  const files = (await Promise.all(extractedDirs.map(walk))).flat();
  const samples = {};
  const used = new Set();

  for (const rule of RULES) {
    const picked = [];
    for (const file of files) {
      if (picked.length >= rule.max) break;
      if (used.has(file) || !matches(file, rule)) continue;
      const ext = extname(file).toLowerCase();
      const safeKey = rule.key.replaceAll('.', '-');
      const dest = join(OUT, `${safeKey}-${picked.length + 1}${ext}`);
      await writeFile(dest, await readFile(file));
      used.add(file);
      picked.push(rel(dest));
    }
    if (picked.length) samples[rule.key] = picked;
  }

  await writeFile(MANIFEST, JSON.stringify({ samples }, null, 2) + '\n');
  await writeFile(join(OUT, 'LICENSES.md'), `# Bundled downloaded audio licenses\n\n${PACKS.map(pack => `- ${pack.name} by ${pack.author}: ${pack.license}; source ${pack.page}`).join('\n')}\n`);
  console.log(`Wrote ${Object.values(samples).flat().length} audio files and updated ${rel(MANIFEST)}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
