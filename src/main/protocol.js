// =============================================================================
//  protocol.js : protocole local "app://" pour servir les fichiers de
//  l'application à la page (plus sûr et plus fiable que file:// pour les
//  modules JavaScript et le chargement du modèle .glb).
//
//    app://bundle/<chemin>                → fichier de l'application
//    app://bundle/user-model/monkey.glb   → modèle 3D personnalisé (s'il existe)
// =============================================================================
const { protocol, app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'app';
const HOST = 'bundle';
const MODEL_PATH = '/user-model/monkey.glb';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
};

// À appeler AVANT que l'application soit prête.
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

// À appeler une fois l'application prête.
function handleProtocol({ getModelFile }) {
  const root = app.getAppPath();
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('Not found', { status: 404 });

    let file;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === MODEL_PATH) {
      file = getModelFile();
    } else {
      file = path.join(root, path.normalize(pathname));
      const rel = path.relative(root, file);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return new Response('Forbidden', { status: 403 });
    }
    if (!file) return new Response('Not found', { status: 404 });

    try {
      const body = await fs.promises.readFile(file);
      const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      return new Response(body, { headers: { 'content-type': type, 'cache-control': 'no-cache' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

const pageUrl = (rel) => `${SCHEME}://${HOST}/${rel}`;
const modelUrl = () => `${SCHEME}://${HOST}${MODEL_PATH}`;

module.exports = { registerScheme, handleProtocol, pageUrl, modelUrl };
