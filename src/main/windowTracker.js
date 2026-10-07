// =============================================================================
//  windowTracker.js : liste des fenêtres ouvertes (Windows uniquement).
//
//  Sert au bonus "grimper / s'asseoir sur le bord des fenêtres", à la
//  détection des applications en plein écran, et à la bêtise "déplacer une
//  fenêtre" quand le singe est fâché. Utilise koffi (FFI) pour appeler
//  directement l'API Win32 (EnumWindows, DwmGetWindowAttribute...), sans
//  compilation native ni processus PowerShell coûteux.
//
//  Toutes les coordonnées renvoyées ici sont en pixels PHYSIQUES ; main.js les
//  convertit en pixels logiques (DIP) avec screen.screenToDipRect().
// =============================================================================

let koffi = null;
try {
  koffi = require('koffi');
} catch {
  koffi = null; // dépendance optionnelle absente : la fonctionnalité est désactivée
}

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;
const WS_CAPTION = 0x00c00000;
const WS_EX_TRANSPARENT = 0x20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_APPWINDOW = 0x40000;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;
const DWMWA_CLOAKED = 14;
// SetWindowPos : ne pas redimensionner, ne pas changer l'ordre, ne pas activer,
// et ne pas attendre l'appli (si elle est figée, on ne bloque pas).
const SWP_FLAGS = 0x0001 | 0x0004 | 0x0010 | 0x0200 | 0x4000;

// Bureau (fond d'écran) : jamais un rebord, jamais une appli "plein écran".
const DESKTOP_CLASSES = new Set(['Progman', 'WorkerW']);
// Éléments du shell Windows : barre des tâches, menus, zones de notification...
const SHELL_CLASSES = new Set([
  'Shell_TrayWnd',
  'Shell_SecondaryTrayWnd',
  'NotifyIconOverflowWindow',
  'Windows.UI.Core.CoreWindow',
  'XamlExplorerHostIslandWindow',
  'TopLevelWindowForOverflowXamlIsland',
  'ForegroundStaging',
]);

let win32 = null; // déclarations FFI, créées une seule fois

function loadWin32() {
  if (win32) return win32;
  const user32 = koffi.load('user32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const HWND = koffi.pointer('HWND', koffi.opaque());
  const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
  koffi.proto('int __stdcall EnumWindowsProc(HWND hwnd, intptr_t lParam)');
  win32 = {
    RECT_SIZE: koffi.sizeof(RECT),
    EnumWindows: user32.func('int __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)'),
    IsWindow: user32.func('int __stdcall IsWindow(HWND hwnd)'),
    IsWindowVisible: user32.func('int __stdcall IsWindowVisible(HWND hwnd)'),
    IsIconic: user32.func('int __stdcall IsIconic(HWND hwnd)'),
    IsZoomed: user32.func('int __stdcall IsZoomed(HWND hwnd)'),
    GetWindowRect: user32.func('int __stdcall GetWindowRect(HWND hwnd, _Out_ RECT *rect)'),
    GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(HWND hwnd)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(HWND hwnd, void *buffer, int maxCount)'),
    GetWindowLongW: user32.func('int32 __stdcall GetWindowLongW(HWND hwnd, int index)'),
    GetForegroundWindow: user32.func('HWND __stdcall GetForegroundWindow()'),
    SetWindowPos: user32.func(
      'int __stdcall SetWindowPos(HWND hwnd, HWND insertAfter, int x, int y, int cx, int cy, uint32 flags)',
    ),
    DwmGetRect: dwmapi.func('__stdcall', 'DwmGetWindowAttribute', 'int32', [
      HWND,
      'uint32',
      koffi.out(koffi.pointer(RECT)),
      'uint32',
    ]),
    DwmGetInt: dwmapi.func('__stdcall', 'DwmGetWindowAttribute', 'int32', [
      HWND,
      'uint32',
      koffi.out(koffi.pointer('int32')),
      'uint32',
    ]),
  };
  return win32;
}

class WindowTracker {
  /** Retourne un tracker, ou null si la plateforme / koffi ne le permettent pas. */
  static create(ownHandleBuffer) {
    if (process.platform !== 'win32' || !koffi) return null;
    try {
      return new WindowTracker(ownHandleBuffer);
    } catch (err) {
      console.warn('[singe] suivi des fenêtres indisponible :', err.message);
      return null;
    }
  }

  constructor(ownHandleBuffer) {
    this.api = loadWin32();
    this.own = readHandle(ownHandleBuffer);
    this.byId = new Map(); // id -> HWND (pour le suivi rapide)
    this.ledgeIds = new Set(); // "vraies" fenêtres d'applications du dernier balayage
    this.classBuf = Buffer.alloc(512);
    this.moveTimer = null;
  }

  /**
   * Énumère les fenêtres visibles, de la plus en avant à la plus en arrière.
   * Retourne [{ id, rect: {left, top, right, bottom}, ledge: bool }].
   */
  scan() {
    const A = this.api;
    const list = [];
    const byId = new Map();
    const ledgeIds = new Set();
    A.EnumWindows((hwnd) => {
      try {
        if (!A.IsWindowVisible(hwnd) || A.IsIconic(hwnd)) return 1;
        const addr = koffi.address(hwnd);
        if (addr === this.own) return 1;
        const ex = A.GetWindowLongW(hwnd, GWL_EXSTYLE);
        if (ex & WS_EX_TRANSPARENT) return 1; // fenêtres "fantômes" que la souris traverse
        if (this.isCloaked(hwnd)) return 1; // autre bureau virtuel, appli suspendue...
        const r = this.frameRect(hwnd);
        if (!r) return 1;
        const w = r.right - r.left;
        const h = r.bottom - r.top;
        if (w < 40 || h < 20) return 1;
        const cls = this.className(hwnd);
        if (DESKTOP_CLASSES.has(cls)) return 1;
        const tool = (ex & WS_EX_TOOLWINDOW) !== 0 && (ex & WS_EX_APPWINDOW) === 0;
        const ledge = !tool && !SHELL_CLASSES.has(cls) && w >= 150 && h >= 80 && A.GetWindowTextLengthW(hwnd) > 0;
        const id = addr.toString(16);
        list.push({ id, rect: r, ledge });
        byId.set(id, hwnd);
        if (ledge) ledgeIds.add(id);
      } catch {
        // fenêtre fermée pendant l'énumération : on l'ignore
      }
      return 1;
    }, 0);
    this.byId = byId;
    this.ledgeIds = ledgeIds;
    return list;
  }

  /**
   * Bords supérieurs visibles des fenêtres : on retire les morceaux cachés
   * par les fenêtres situées devant.
   * Retourne [{ id, left, right, y, segs: [[x1, x2], ...] }] (pixels physiques).
   */
  static ledgesFrom(list) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      if (!w.ledge) continue;
      const y = w.rect.top;
      let segs = [[w.rect.left, w.rect.right]];
      for (let j = 0; j < i && segs.length; j++) {
        const o = list[j].rect;
        if (o.top <= y + 2 && o.bottom >= y - 2) segs = subtract(segs, o.left, o.right);
      }
      segs = segs.filter(([a, b]) => b - a >= 40);
      if (segs.length) out.push({ id: w.id, left: w.rect.left, right: w.rect.right, y, segs });
    }
    return out;
  }

  /** Position actuelle d'une fenêtre (suivi rapide pendant qu'il est dessus). */
  poll(id) {
    const A = this.api;
    const hwnd = this.byId.get(id);
    if (!hwnd) return { id, gone: true };
    try {
      if (!A.IsWindow(hwnd) || !A.IsWindowVisible(hwnd) || A.IsIconic(hwnd) || this.isCloaked(hwnd)) {
        return { id, gone: true };
      }
      const rect = this.frameRect(hwnd);
      return rect ? { id, rect } : { id, gone: true };
    } catch {
      return { id, gone: true };
    }
  }

  /**
   * Bêtise : fait glisser une fenêtre de (dx, dy) pixels physiques en `ms`
   * millisecondes, avec un petit tremblement au départ, sans l'activer.
   * Seulement une "vraie" fenêtre d'application repérée au dernier balayage,
   * jamais une fenêtre agrandie ou réduite. Retourne true si c'est parti.
   */
  moveBy(id, dx, dy, ms = 900) {
    const A = this.api;
    const hwnd = this.byId.get(id);
    if (!hwnd || !this.ledgeIds.has(id)) return false;
    try {
      if (!A.IsWindow(hwnd) || A.IsIconic(hwnd) || A.IsZoomed(hwnd)) return false;
      const r = {};
      if (!A.GetWindowRect(hwnd, r)) return false;
      clearInterval(this.moveTimer);
      const t0 = Date.now();
      const step = () => {
        let t = Math.min(1, (Date.now() - t0) / ms);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // accélère puis freine
        const shake = t < 0.25 ? Math.sin(t * 90) * 6 * (1 - t / 0.25) : 0; // il prend son élan
        try {
          A.SetWindowPos(hwnd, null, Math.round(r.left + dx * e + shake), Math.round(r.top + dy * e), 0, 0, SWP_FLAGS);
        } catch {
          t = 1; // fenêtre fermée entre-temps
        }
        if (t >= 1) {
          clearInterval(this.moveTimer);
          this.moveTimer = null;
        }
      };
      this.moveTimer = setInterval(step, 16);
      step();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Rectangle de la fenêtre au premier plan si elle PEUT être en plein écran
   * (null pour le bureau, la barre des tâches, ou une fenêtre simplement
   * agrandie avec sa barre de titre — qui couvre tout l'écran quand la barre
   * des tâches est masquée automatiquement).
   */
  foregroundRect() {
    const A = this.api;
    try {
      const fg = A.GetForegroundWindow();
      if (!fg || koffi.address(fg) === this.own) return null;
      const cls = this.className(fg);
      if (DESKTOP_CLASSES.has(cls) || SHELL_CLASSES.has(cls)) return null;
      const style = A.GetWindowLongW(fg, GWL_STYLE);
      if (A.IsZoomed(fg) && (style & WS_CAPTION) === WS_CAPTION) return null;
      const r = {};
      return A.GetWindowRect(fg, r) ? r : null;
    } catch {
      return null;
    }
  }

  // Bords visibles (sans les bordures invisibles de redimensionnement de Windows 10/11).
  frameRect(hwnd) {
    const A = this.api;
    const r = {};
    if (A.DwmGetRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, A.RECT_SIZE) === 0) return r;
    const r2 = {};
    return A.GetWindowRect(hwnd, r2) ? r2 : null;
  }

  isCloaked(hwnd) {
    const v = [0];
    return this.api.DwmGetInt(hwnd, DWMWA_CLOAKED, v, 4) === 0 && v[0] !== 0;
  }

  className(hwnd) {
    const n = this.api.GetClassNameW(hwnd, this.classBuf, this.classBuf.length / 2);
    return n > 0 ? this.classBuf.toString('utf16le', 0, n * 2) : '';
  }
}

function readHandle(buf) {
  if (!buf || !buf.length) return 0n;
  return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
}

// Retire l'intervalle [a, b] d'une liste de segments.
function subtract(segs, a, b) {
  const out = [];
  for (const [x1, x2] of segs) {
    if (b <= x1 || a >= x2) out.push([x1, x2]);
    else {
      if (a > x1) out.push([x1, a]);
      if (b < x2) out.push([b, x2]);
    }
  }
  return out;
}

module.exports = { WindowTracker };
