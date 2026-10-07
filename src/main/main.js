// =============================================================================
//  main.js : processus principal Electron.
//
//  - crée une fenêtre transparente, sans bordure, toujours au premier plan,
//    qui couvre l'écran où se trouve le singe (elle "saute" d'un écran à
//    l'autre quand il change d'écran) ;
//  - rend la fenêtre transparente aux clics sauf sur le singe (avec la page) ;
//  - gère l'icône de notification, les réglages, le lancement au démarrage ;
//  - surveille les fenêtres ouvertes (Windows) pour qu'il puisse y grimper ;
//  - exécute ses bêtises quand il est fâché (déplacer une fenêtre, ouvrir une note).
// =============================================================================
const { app, BrowserWindow, screen, ipcMain, powerMonitor, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const settings = require('./settings');
const { registerScheme, handleProtocol, pageUrl, modelUrl } = require('./protocol');
const { createTray } = require('./tray');
const { WindowTracker } = require('./windowTracker');

const DEV = process.argv.includes('--dev'); // ouvre les DevTools
const VERBOSE = DEV || process.argv.includes('--verbose'); // affiche la console de la page

// Fréquences de surveillance (ms) : plus grand = moins de CPU.
const SCAN_EVERY = 1000; // liste complète des fenêtres (rebords + plein écran)
const TRACK_EVERY = 50; // fenêtre sur laquelle se trouve le singe (il suit ses mouvements)
const IDLE_EVERY = 5000; // inactivité de l'utilisateur (pour l'endormir)
const TOPMOST_EVERY = 4000; // repasse au premier plan (si une autre fenêtre "toujours visible" est passée devant)
const DRAG_POLL_EVERY = 33; // pendant un glisser : le curseur est-il passé sur un autre écran ?

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

let win = null;
let tray = null;
let tracker = null;
let currentDisplay = null;
let rendererReady = false;
let dragging = false;
let dragTimer = null;
let trackedId = null;
let lastLedgesJson = '';
let lastTrackJson = '';
const hiddenReasons = new Set(); // 'fullscreen', 'locked'
const timers = [];

registerScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => recall()); // relancer l'appli = rappeler le singe
  app.whenReady().then(start);
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  settings.save();
  for (const t of timers) clearInterval(t);
  tray?.destroy();
});

// -----------------------------------------------------------------------------
//  Démarrage
// -----------------------------------------------------------------------------
function start() {
  if (IS_WIN) app.setAppUserModelId('com.singedebureau.app');
  if (IS_MAC) app.dock?.hide();

  settings.load();
  handleProtocol({ getModelFile: findModelFile });

  const displays = screen.getAllDisplays();
  currentDisplay = displays.find((d) => d.id === settings.get().lastDisplayId) ?? screen.getPrimaryDisplay();
  createOverlay(currentDisplay);

  tracker = WindowTracker.create(win.getNativeWindowHandle());
  tray = createTray({
    getSettings: settings.get,
    onChange: updateSettings,
    onRecall: recall,
    onCommand: (cmd) => send('pet:command', cmd),
    onOpenModelFolder: openModelFolder,
    onReload: () => win?.reload(),
    onQuit: () => app.quit(),
    loginItem: { supported: IS_WIN || IS_MAC, get: getOpenAtLogin, set: setOpenAtLogin },
    windowsFeatures: !!tracker,
  });

  setupIpc();

  let displayTimer = null;
  const onDisplaysChanged = () => {
    clearTimeout(displayTimer);
    displayTimer = setTimeout(refreshDisplays, 250);
  };
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
  screen.on('display-metrics-changed', onDisplaysChanged);

  powerMonitor.on('lock-screen', () => setHidden('locked', true));
  powerMonitor.on('unlock-screen', () => setHidden('locked', false));
  powerMonitor.on('suspend', () => setHidden('locked', true));
  powerMonitor.on('resume', () => {
    setHidden('locked', false);
    refreshDisplays();
  });

  timers.push(setInterval(scanWindows, SCAN_EVERY));
  timers.push(setInterval(pollTrackedWindow, TRACK_EVERY));
  timers.push(setInterval(sendUserIdle, IDLE_EVERY));
  timers.push(
    setInterval(() => {
      if (win && win.isVisible() && !dragging) win.moveTop();
    }, TOPMOST_EVERY),
  );
}

// -----------------------------------------------------------------------------
//  Fenêtre transparente plein écran
// -----------------------------------------------------------------------------
function createOverlay(display) {
  win = new BrowserWindow({
    ...display.bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false, // cliquer sur le singe ne vole pas le focus de vos applis
    alwaysOnTop: true,
    thickFrame: false,
    // 'toolbar' : absent de la barre des tâches et d'Alt+Tab (Windows) ; 'panel' : flotte au-dessus des applis plein écran (macOS)
    type: IS_WIN ? 'toolbar' : IS_MAC ? 'panel' : undefined,
    title: 'Singe de bureau',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // continuer à animer même sans focus
      spellcheck: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('did-start-loading', () => {
    // Rechargement : on repart d'un état propre (clics traversants, pas de glisser).
    rendererReady = false;
    dragging = false;
    clearInterval(dragTimer);
    win.setIgnoreMouseEvents(true, { forward: true });
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[singe] page plantée :', details.reason);
    setTimeout(() => win?.reload(), 1000);
  });
  if (VERBOSE) {
    win.webContents.on('console-message', (event, level, message) => {
      console.log('[page]', event.message ?? message);
    });
  }

  win.once('ready-to-show', () => {
    if (!hiddenReasons.size) win.showInactive();
  });
  win.on('closed', () => {
    win = null;
  });

  win.loadURL(pageUrl('src/renderer/index.html'));
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
}

function send(channel, data) {
  if (win && !win.isDestroyed() && rendererReady) win.webContents.send(channel, data);
}

// Coordonnées et voisins de l'écran, envoyés à la page (voir world.js).
function worldFor(display) {
  const b = display.bounds;
  const wa = display.workArea;
  return {
    displayId: display.id,
    scaleFactor: display.scaleFactor,
    bounds: { ...b },
    workArea: { x: wa.x - b.x, y: wa.y - b.y, width: wa.width, height: wa.height },
    neighbors: neighborsOf(display),
  };
}

// Écrans collés à gauche / à droite (pour que le singe puisse y aller à pied).
function neighborsOf(display) {
  const b = display.bounds;
  const out = { left: [], right: [] };
  for (const o of screen.getAllDisplays()) {
    if (o.id === display.id) continue;
    const top = Math.max(o.bounds.y, b.y) - b.y;
    const bottom = Math.min(o.bounds.y + o.bounds.height, b.y + b.height) - b.y;
    if (bottom - top < 50) continue;
    if (Math.abs(o.bounds.x + o.bounds.width - b.x) <= 2) out.left.push({ top, bottom });
    if (Math.abs(b.x + b.width - o.bounds.x) <= 2) out.right.push({ top, bottom });
  }
  return out;
}

function setWindowBounds(bounds) {
  if (!win) return;
  win.setBounds(bounds);
  // Entre deux écrans de DPI différents, Windows peut mal redimensionner la
  // fenêtre au premier essai : on vérifie et on recommence si besoin.
  setTimeout(() => {
    if (!win) return;
    const now = win.getBounds();
    if (now.x !== bounds.x || now.y !== bounds.y || now.width !== bounds.width || now.height !== bounds.height) {
      win.setBounds(bounds);
    }
  }, 50);
}

function moveToDisplay(display) {
  currentDisplay = display;
  settings.set({ lastDisplayId: display.id });
  setWindowBounds(display.bounds);
  lastLedgesJson = '';
  lastTrackJson = '';
  send('pet:world', worldFor(display));
  scanWindows();
}

function refreshDisplays() {
  if (!win) return;
  const d = screen.getAllDisplays().find((x) => x.id === currentDisplay.id) ?? screen.getPrimaryDisplay();
  moveToDisplay(d);
}

function followCursorWhileDragging() {
  if (!win || !dragging) return;
  const d = displayContaining(screen.getCursorScreenPoint());
  if (d && d.id !== currentDisplay.id) moveToDisplay(d);
}

function displayContaining(pt) {
  return screen.getAllDisplays().find((d) => {
    const b = d.bounds;
    return pt.x >= b.x && pt.y >= b.y && pt.x < b.x + b.width && pt.y < b.y + b.height;
  });
}

function setHidden(reason, hidden) {
  const wasVisible = hiddenReasons.size === 0;
  if (hidden) hiddenReasons.add(reason);
  else hiddenReasons.delete(reason);
  const visible = hiddenReasons.size === 0;
  if (!win || visible === wasVisible) return;
  if (visible) {
    win.setIgnoreMouseEvents(true, { forward: true });
    win.showInactive();
    win.moveTop();
  } else {
    win.hide();
  }
  send('pet:visibility', visible);
}

// -----------------------------------------------------------------------------
//  Communication avec la page
// -----------------------------------------------------------------------------
function setupIpc() {
  const fromPet = (handler) => (event, arg) => {
    if (win && event.sender === win.webContents) handler(arg);
  };

  ipcMain.on(
    'pet:ready',
    fromPet(() => {
      rendererReady = true;
      lastLedgesJson = '';
      lastTrackJson = '';
      send('pet:init', {
        settings: settings.get(),
        world: worldFor(currentDisplay),
        modelUrl: findModelFile() ? modelUrl() : null,
        debug: VERBOSE,
      });
      send('pet:visibility', hiddenReasons.size === 0);
      sendUserIdle();
      scanWindows();
    }),
  );

  // Clics traversants partout, sauf sur le singe (décidé par la page).
  ipcMain.on(
    'pet:ignore-mouse',
    fromPet((ignore) => {
      win.setIgnoreMouseEvents(!!ignore, { forward: true });
    }),
  );

  ipcMain.on(
    'pet:dragging',
    fromPet((v) => {
      dragging = !!v;
      // Sous Windows, une fenêtre qui n'a pas le focus ne "capture" pas la
      // souris : la page ne voit pas le curseur quitter son écran. On surveille
      // donc le curseur ici et on déplace la fenêtre sur l'écran qu'il survole.
      clearInterval(dragTimer);
      dragTimer = dragging ? setInterval(followCursorWhileDragging, DRAG_POLL_EVERY) : null;
    }),
  );

  // Le singe veut aller sur l'écran qui contient ce point (marche ou glisser).
  ipcMain.on(
    'pet:display-at',
    fromPet((pt) => {
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return;
      const d = displayContaining(pt);
      if (d && d.id !== currentDisplay.id) moveToDisplay(d);
    }),
  );

  ipcMain.on(
    'pet:track-window',
    fromPet((id) => {
      trackedId = typeof id === 'string' ? id : null;
      lastTrackJson = '';
    }),
  );

  ipcMain.on(
    'pet:show-menu',
    fromPet(() => tray?.popup(win)),
  );

  // Bêtises du singe fâché (seulement si elles sont cochées dans le menu "Jeu").
  ipcMain.on(
    'pet:prank',
    fromPet((p) => {
      if (!p || typeof p !== 'object') return;
      const s = settings.get();
      if (p.type === 'note' && s.prankNotes) {
        writeAngryNote(Math.max(1, Math.min(99, Math.floor(Number(p.count)) || 1)));
      } else if (p.type === 'move-window' && s.prankWindows && tracker && typeof p.id === 'string') {
        const sf = currentDisplay.scaleFactor || 1; // la page parle en pixels logiques, Windows en pixels réels
        const dx = clampNumber(p.dx, -800, 800);
        const dy = clampNumber(p.dy, -400, 400);
        tracker.moveBy(p.id, Math.round(dx * sf), Math.round(dy * sf));
      }
    }),
  );
}

function clampNumber(v, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
}

// -----------------------------------------------------------------------------
//  Réglages
// -----------------------------------------------------------------------------
function updateSettings(patch) {
  const s = settings.set(patch);
  send('pet:settings', s);
  if ('hideOnFullscreen' in patch && !s.hideOnFullscreen) setHidden('fullscreen', false);
  if ('climbWindows' in patch || 'hideOnFullscreen' in patch) {
    lastLedgesJson = '';
    scanWindows();
  }
  tray?.refresh();
}

function loginItemOptions() {
  // Version portable : l'exe tourne depuis un dossier temporaire, on enregistre le vrai fichier.
  if (process.env.PORTABLE_EXECUTABLE_FILE) return { path: process.env.PORTABLE_EXECUTABLE_FILE };
  // En développement, il faut indiquer à Electron quel projet relancer.
  return app.isPackaged ? {} : { path: process.execPath, args: [path.resolve(app.getAppPath())] };
}
function getOpenAtLogin() {
  try {
    return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
  } catch {
    return false;
  }
}
function setOpenAtLogin(on) {
  app.setLoginItemSettings({ openAtLogin: on, ...loginItemOptions() });
  tray?.refresh();
}

function recall() {
  if (!win) return;
  const pt = screen.getCursorScreenPoint();
  const d = screen.getDisplayNearestPoint(pt);
  if (d.id !== currentDisplay.id) moveToDisplay(d);
  send('pet:command', { type: 'recall', x: pt.x - d.bounds.x, y: pt.y - d.bounds.y });
}

// -----------------------------------------------------------------------------
//  Modèle 3D personnalisé (.glb)
// -----------------------------------------------------------------------------
function findModelFile() {
  const candidates = [
    path.join(app.getPath('userData'), 'monkey.glb'),
    path.join(app.getAppPath(), 'assets', 'models', 'monkey.glb'),
  ];
  return (
    candidates.find((f) => {
      try {
        return fs.statSync(f).isFile();
      } catch {
        return false;
      }
    }) ?? null
  );
}

// Écrit une note "DONNE BANANES !!" (de plus en plus insistante) et l'ouvre
// dans l'éditeur de texte par défaut (le Bloc-notes sous Windows).
function writeAngryNote(count) {
  const name = `DONNE BANANES ${'!'.repeat(1 + Math.min(count, 8))}.txt`;
  const file = path.join(app.getPath('temp'), name);
  const shouts = Array.from(
    { length: Math.min(2 + count * 3, 40) },
    (_, i) => `DONNE BANANES ${'!'.repeat(2 + (i % 5))}`,
  );
  const lines = [
    '🍌🍌🍌   DONNE BANANES !!   🍌🍌🍌',
    '',
    ...shouts,
    '',
    count > 1 ? `(c'est la ${count}e fois que je demande...)` : '',
    '— ton singe, pas content du tout 😠',
  ];
  try {
    fs.writeFileSync(file, lines.join('\r\n'), 'utf8');
    shell.openPath(file).then((err) => {
      if (err) console.warn('[singe] impossible d’ouvrir la note :', err);
    });
  } catch (err) {
    console.warn('[singe] impossible d’écrire la note :', err.message);
  }
}

function openModelFolder() {
  const dir = app.getPath('userData');
  const readme = path.join(dir, 'LISEZ-MOI - modele 3D.txt');
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(
        readme,
        [
          'Déposez ici un fichier nommé "monkey.glb" pour remplacer le singe intégré,',
          'puis choisissez "Modèle 3D > Recharger le singe" dans le menu de l’icône.',
          '',
          'Noms d’animations reconnus (insensibles à la casse, un nom partiel suffit) :',
          'idle, walk, sit, sleep, scratch, wave, jump, fall, land, climb, drag, happy, yawn.',
          'Supprimez le fichier pour revenir au singe intégré.',
        ].join('\r\n'),
      );
    }
  } catch {
    /* dossier en lecture seule : tant pis pour le mémo */
  }
  shell.openPath(dir);
}

// -----------------------------------------------------------------------------
//  Surveillance (fenêtres, plein écran, inactivité)
// -----------------------------------------------------------------------------
function sendUserIdle() {
  send('pet:user-idle', powerMonitor.getSystemIdleTime());
}

function toDip(x, y, width, height) {
  return screen.screenToDipRect(null, { x, y, width: Math.max(1, width), height: Math.max(1, height) });
}

function scanWindows() {
  if (!tracker || !win || !rendererReady || hiddenReasons.has('locked')) return;
  const s = settings.get();
  if (!s.climbWindows && !s.hideOnFullscreen) return;

  if (s.hideOnFullscreen) checkFullscreen();
  if (!s.climbWindows) return;

  let list;
  try {
    list = tracker.scan();
  } catch (err) {
    console.error('[singe] erreur pendant la liste des fenêtres :', err.message);
    return;
  }
  const b = currentDisplay.bounds;
  const ledges = [];
  for (const l of WindowTracker.ledgesFrom(list)) {
    const full = toDip(l.left, l.y, l.right - l.left, 1);
    const y = Math.round(full.y - b.y);
    if (y < 0 || y > b.height) continue;
    const segs = [];
    for (const [x1, x2] of l.segs) {
      const r = toDip(x1, l.y, x2 - x1, 1);
      const a = Math.max(0, Math.round(r.x - b.x));
      const c = Math.min(b.width, Math.round(r.x + r.width - b.x));
      if (c - a >= 30) segs.push([a, c]);
    }
    if (!segs.length) continue;
    ledges.push({
      id: l.id,
      left: Math.round(full.x - b.x),
      right: Math.round(full.x + full.width - b.x),
      y,
      segs,
    });
  }
  const json = JSON.stringify(ledges);
  if (json !== lastLedgesJson) {
    lastLedgesJson = json;
    send('pet:ledges', ledges);
  }
}

function pollTrackedWindow() {
  if (!tracker || !trackedId || !rendererReady || hiddenReasons.size) return;
  const r = tracker.poll(trackedId);
  let msg;
  if (r.gone) {
    msg = { id: trackedId, gone: true };
  } else {
    const d = toDip(r.rect.left, r.rect.top, r.rect.right - r.rect.left, 1);
    const b = currentDisplay.bounds;
    msg = {
      id: trackedId,
      left: Math.round(d.x - b.x),
      right: Math.round(d.x + d.width - b.x),
      y: Math.round(d.y - b.y),
    };
  }
  const json = JSON.stringify(msg);
  if (json === lastTrackJson) return;
  lastTrackJson = json;
  send('pet:ledge-move', msg);
}

// Une appli occupe tout l'écran du singe (vidéo, jeu, présentation) : il se cache.
function checkFullscreen() {
  const r = tracker.foregroundRect();
  let fullscreen = false;
  if (r) {
    const d = toDip(r.left, r.top, r.right - r.left, r.bottom - r.top);
    const b = currentDisplay.bounds;
    fullscreen =
      d.x <= b.x + 1 && d.y <= b.y + 1 && d.x + d.width >= b.x + b.width - 1 && d.y + d.height >= b.y + b.height - 1;
  }
  if (!dragging) setHidden('fullscreen', fullscreen);
}
