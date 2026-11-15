// Frostline Depot — handover program (Node 22, standard library only).
//
// The playable game lives in game/ as plain static files: the browser
// loads them as ES modules, pulls three.js in through an import map,
// and never touches the network. This program's whole job is delivery:
// copy game/ and screenshots/ into the output folder and stamp the
// folder with dossier.json, the summary the judges read, produced by
// the vendored make.fun library in vendor/.
//
// When the grader runs this, the output folder is /output. Locally you
// can point MAKEFUN_OUTPUT_DIR anywhere instead:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Lay the game down first, then the screenshots beside it.
mkdirSync(outputDir, { recursive: true });
cpSync(join(repoDir, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoDir, 'screenshots'))) {
  cpSync(join(repoDir, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

// The dossier call mirrors the platform's own caps: the text summary is
// capped at 160 KiB, screenshots at 4 files of 256 KiB each, and game/
// at 993 entries / 48 MiB — an entry past those lines would be refused
// by the scorer anyway, so the library is told to enforce them here.
writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
