// =============================================================================
//  platform.js : pont entre la page (le singe) et le programme principal en
//  Rust (src-tauri/). Toute la communication passe par cet objet `petAPI` :
//   - commandes (page → Rust) avec invoke(...)
//   - événements (Rust → page) avec listen(...)
// =============================================================================
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Une commande qui échoue ne doit jamais bloquer l'animation.
function call(command, args) {
  return invoke(command, args).catch((err) => {
    console.warn(`[singe] commande ${command} :`, err);
    return null;
  });
}

const on = (event) => (callback) => {
  listen(event, (e) => callback(e.payload));
};

let initCallback = null;

export const petAPI = {
  // Démarrage : récupère réglages, écran, modèle personnalisé...
  onInit(callback) {
    initCallback = callback;
  },
  async ready() {
    const init = await call('pet_ready');
    if (!init) return;
    // Modèle .glb personnalisé, servi par le protocole "petmodel" (voir main.rs)
    // Priorité au modèle du dossier de données, puis à celui intégré à l'exe.
    init.modelUrl = init.hasUserModel
      ? convertFileSrc('monkey.glb', 'petmodel')
      : init.hasBundledModel
        ? 'models/monkey.glb'
        : null;
    initCallback?.(init);
  },

  // Page → programme principal
  setIgnoreMouse: (ignore) => call('set_ignore_mouse', { ignore: !!ignore }),
  setDragging: (dragging) => call('set_dragging', { dragging: !!dragging }),
  moveToDisplayAt: (x, y) => call('move_to_display_at', { x, y }),
  trackWindow: (id) => call('track_window', { id: id ?? null }),
  showMenu: () => call('show_menu'),
  // Bêtises : { type: 'note', count } ou { type: 'move-window', id, dx, dy }
  prank: (prank) => call('prank', { prank }),
  // Auto-test (intégration continue) : rapport de la page
  report: (report) => call('selftest_report', { report }),

  // Programme principal → page
  onWorld: on('pet:world'),
  onSettings: on('pet:settings'),
  onLedges: on('pet:ledges'),
  onLedgeMove: on('pet:ledge-move'),
  onUserIdle: on('pet:user-idle'),
  onVisibility: on('pet:visibility'),
  onCommand: on('pet:command'),
  onCursor: on('pet:cursor'),
};
