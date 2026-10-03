// =============================================================================
//  settings.js : réglages persistants (fichier settings.json dans le dossier
//  de données de l'application, ex. %APPDATA%\Singe de bureau\settings.json).
// =============================================================================
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Choix proposés dans le menu de la zone de notification.
const SPEEDS = [
  { label: 'Tortue (×0,5)', value: 0.5 },
  { label: 'Normale (×1)', value: 1 },
  { label: 'Rapide (×1,5)', value: 1.5 },
  { label: 'Turbo (×2)', value: 2 },
];
const SIZES = [
  { label: 'Petit (100 px)', value: 100 },
  { label: 'Moyen (125 px)', value: 125 },
  { label: 'Grand (150 px)', value: 150 },
  { label: 'Très grand (200 px)', value: 200 },
];

const DEFAULTS = {
  paused: false,
  speed: 1, // multiplicateur des vitesses de déplacement
  size: 125, // hauteur du singe en pixels
  climbWindows: true, // grimper / s'asseoir sur les fenêtres (Windows)
  hideOnFullscreen: true, // se cacher quand une appli est en plein écran (Windows)
  lastDisplayId: null, // dernier écran où il se trouvait
};

let data = { ...DEFAULTS };
let file = null;
let saveTimer = null;

function sanitize(d) {
  const out = { ...DEFAULTS, ...d };
  if (!(typeof out.speed === 'number' && out.speed > 0 && out.speed <= 5)) out.speed = DEFAULTS.speed;
  if (!(typeof out.size === 'number' && out.size >= 40 && out.size <= 600)) out.size = DEFAULTS.size;
  for (const k of ['paused', 'climbWindows', 'hideOnFullscreen']) out[k] = !!out[k];
  return out;
}

function load() {
  file = path.join(app.getPath('userData'), 'settings.json');
  try {
    data = sanitize(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    data = { ...DEFAULTS };
  }
  return data;
}

function get() {
  return data;
}

function set(patch) {
  data = sanitize({ ...data, ...patch });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 300);
  return data;
}

function save() {
  clearTimeout(saveTimer);
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[singe] impossible d’enregistrer les réglages :', err.message);
  }
}

module.exports = { load, get, set, save, SPEEDS, SIZES, DEFAULTS };
