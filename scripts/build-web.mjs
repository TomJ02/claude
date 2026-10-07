// =============================================================================
//  build-web.mjs : fabrique la page du singe dans dist-web/ (embarquée ensuite
//  dans l'exécutable par Tauri).
//   - src/renderer/*.js + three.js → un seul fichier app.js minifié (esbuild ne
//     garde que les parties de three.js réellement utilisées) ;
//   - index.html, style.css, et un éventuel assets/models/monkey.glb.
//
//  npm run web            → version minifiée
//  npm run web -- --dev   → version lisible avec cartes de source (débogage)
//  npm run web -- --watch → reconstruit à chaque modification
// =============================================================================
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'dist-web');
const dev = process.argv.includes('--dev') || process.argv.includes('--watch');
const watch = process.argv.includes('--watch');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

function copyStatic() {
  for (const f of ['index.html', 'style.css']) {
    fs.copyFileSync(path.join(root, 'src/renderer', f), path.join(out, f));
  }
  const model = path.join(root, 'assets/models/monkey.glb');
  if (fs.existsSync(model)) {
    fs.mkdirSync(path.join(out, 'models'), { recursive: true });
    fs.copyFileSync(model, path.join(out, 'models/monkey.glb'));
  }
}

const options = {
  absWorkingDir: root,
  entryPoints: { app: 'src/renderer/renderer.js' },
  bundle: true,
  format: 'esm',
  splitting: true, // le chargeur .glb n'est téléchargé que s'il sert
  outdir: out,
  chunkNames: 'chunks/[name]-[hash]',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  target: ['es2022'],
  legalComments: 'none',
  logLevel: 'info',
  plugins: [{ name: 'static', setup: (b) => b.onEnd(copyStatic) }],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[web] surveillance des modifications…');
} else {
  await esbuild.build(options);
  const size = fs
    .readdirSync(out, { recursive: true })
    .map((f) => path.join(out, f))
    .filter((f) => fs.statSync(f).isFile())
    .reduce((s, f) => s + fs.statSync(f).size, 0);
  console.log(`[web] page prête dans dist-web/ (${(size / 1024).toFixed(0)} Ko)`);
}
