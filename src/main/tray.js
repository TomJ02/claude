// =============================================================================
//  tray.js : icône et menu de la zone de notification.
//  (Le même menu s'ouvre aussi par clic droit sur le singe.)
// =============================================================================
const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('node:path');
const { SPEEDS, SIZES } = require('./settings');

/**
 * @param {object} o
 * @param {() => object} o.getSettings
 * @param {(patch: object) => void} o.onChange
 * @param {() => void} o.onRecall
 * @param {() => void} o.onOpenModelFolder
 * @param {() => void} o.onReload
 * @param {() => void} o.onQuit
 * @param {{ supported: boolean, get: () => boolean, set: (on: boolean) => void }} o.loginItem
 * @param {boolean} o.windowsFeatures  suivi des fenêtres disponible ?
 */
function createTray(o) {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'tray.png';
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', iconFile));
  const tray = new Tray(icon);
  tray.setToolTip('Singe de bureau');

  let menu = null;

  function build() {
    const s = o.getSettings();
    menu = Menu.buildFromTemplate([
      { label: 'Singe de bureau', enabled: false },
      { type: 'separator' },
      { label: s.paused ? 'Reprendre' : 'Pause', click: () => o.onChange({ paused: !s.paused }) },
      {
        label: 'Vitesse',
        submenu: SPEEDS.map((c) => ({
          label: c.label,
          type: 'radio',
          checked: s.speed === c.value,
          click: () => o.onChange({ speed: c.value }),
        })),
      },
      {
        label: 'Taille',
        submenu: SIZES.map((c) => ({
          label: c.label,
          type: 'radio',
          checked: s.size === c.value,
          click: () => o.onChange({ size: c.value }),
        })),
      },
      { type: 'separator' },
      {
        label: 'Grimper sur les fenêtres',
        type: 'checkbox',
        checked: s.climbWindows,
        enabled: o.windowsFeatures,
        click: (item) => o.onChange({ climbWindows: item.checked }),
      },
      {
        label: 'Se cacher pendant le plein écran',
        type: 'checkbox',
        checked: s.hideOnFullscreen,
        enabled: o.windowsFeatures,
        click: (item) => o.onChange({ hideOnFullscreen: item.checked }),
      },
      { label: 'Rappeler le singe ici', click: o.onRecall },
      { type: 'separator' },
      {
        label: 'Lancer au démarrage',
        type: 'checkbox',
        checked: o.loginItem.supported && o.loginItem.get(),
        enabled: o.loginItem.supported,
        click: (item) => o.loginItem.set(item.checked),
      },
      {
        label: 'Modèle 3D',
        submenu: [
          { label: 'Ouvrir le dossier du modèle…', click: o.onOpenModelFolder },
          { label: 'Recharger le singe', click: o.onReload },
        ],
      },
      { type: 'separator' },
      { label: 'Quitter', click: o.onQuit },
    ]);
    tray.setContextMenu(menu);
  }

  // Sous Windows, un clic gauche ouvre aussi le menu.
  tray.on('click', () => tray.popUpContextMenu());
  build();

  return {
    refresh: build,
    popup(window) {
      menu?.popup(window ? { window } : undefined);
    },
    destroy() {
      tray.destroy();
    },
  };
}

module.exports = { createTray };
