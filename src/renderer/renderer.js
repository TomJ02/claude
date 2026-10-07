// =============================================================================
//  renderer.js : point d'entrée de la page (processus de rendu).
//  Assemble la scène 3D, le singe, son cerveau, la souris, et la boucle
//  d'animation à cadence variable (60 i/s quand il bouge, moins au repos,
//  0 quand il est en pause : économie de CPU/GPU).
// =============================================================================
import { CONFIG } from './config.js';
import { Stage } from './stage.js';
import { ProceduralMonkey } from './monkey.js';
import { World } from './world.js';
import { Brain } from './behaviors.js';
import { Input } from './input.js';
import { Effects } from './effects.js';
import { Items } from './items.js';
import { renderSprites } from './sprites.js';
import { petAPI } from './platform.js';

const api = petAPI;
const app = document.getElementById('app');

const stage = new Stage(app, CONFIG);
const world = new World();
const effects = new Effects(app, stage, CONFIG);
const items = new Items({ container: app, stage, world, config: CONFIG });
const loop = createLoop(frame);
const brain = new Brain({
  monkey: new ProceduralMonkey(CONFIG),
  world,
  effects,
  items,
  api,
  config: CONFIG,
  wake: loop.wake,
});
stage.setMonkey(brain.m);
const input = new Input({ stage, brain, world, items, api, config: CONFIG, wake: loop.wake });
items.onLanded = (it) => {
  if (it.kind === 'banana') brain.onBananaLanded(it);
};
try {
  items.setSprites(renderSprites(CONFIG)); // images 3D de la banane et du caca
} catch (err) {
  console.warn('[singe] images des objets indisponibles, émojis utilisés à la place', err);
}

let ready = false;

// Une image : cerveau → animation → placement → effets → rendu.
function frame(dt) {
  if (!ready) return 0;
  brain.update(dt);
  items.update(dt, brain.gameActive);
  brain.m.update(dt);
  input.update(dt);
  stage.place(brain.x, brain.y);
  effects.update(dt, brain);
  stage.render();
  return brain.desiredFps();
}

// -----------------------------------------------------------------------------
//  Boucle à cadence variable
// -----------------------------------------------------------------------------
function createLoop(step) {
  let raf = 0;
  let timer = 0;
  let last = 0;

  let target = 60; // cadence voulue par la dernière image

  function tick(now) {
    raf = 0;
    // Écrans 120/144 Hz (ou moteur sans synchronisation) : on ne dépasse pas
    // la cadence voulue, on attend simplement la prochaine échéance.
    const gap = 1000 / target - 2;
    if (now - last < gap) {
      timer = setTimeout(
        () => {
          timer = 0;
          raf = requestAnimationFrame(tick);
        },
        gap - (now - last),
      );
      return;
    }
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    target = step(dt);
    schedule(target);
  }

  function schedule(fps) {
    if (!fps) return; // plus rien à animer : la boucle s'arrête
    if (fps >= 55) raf = requestAnimationFrame(tick);
    else {
      timer = setTimeout(
        () => {
          timer = 0;
          raf = requestAnimationFrame(tick);
        },
        Math.max(0, 1000 / fps - 8),
      );
    }
  }

  return {
    // Relance la boucle (ou avance la prochaine image) après un événement.
    wake() {
      if (raf) return;
      target = 60; // un événement : on répond dès l'image suivante
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      } else {
        last = performance.now() - 17; // la boucle était arrêtée
      }
      raf = requestAnimationFrame(tick);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      raf = timer = 0;
    },
  };
}

// -----------------------------------------------------------------------------
//  Réglages (menu de la zone de notification)
// -----------------------------------------------------------------------------
function applySettings(s) {
  if (s.size !== stage.size) {
    stage.setSize(s.size);
    brain.setSize(s.size);
    effects.setSize(s.size);
    items.setSize(s.size);
  }
  brain.setGame({ poop: s.poop, bananas: s.bananas, prankWindows: s.prankWindows, prankNotes: s.prankNotes });
  brain.speedMul = s.speed;
  if (s.climbWindows !== brain.climbEnabled) brain.setClimbEnabled(s.climbWindows);
  if (s.paused !== brain.paused) brain.setPaused(s.paused);
  loop.wake();
}

async function loadCustomModel(url) {
  try {
    const { GltfMonkey } = await import('./gltfMonkey.js');
    const monkey = await GltfMonkey.load(url, CONFIG);
    stage.setMonkey(monkey);
    brain.setMonkey(monkey);
    console.info('[singe] modèle personnalisé chargé :', url);
  } catch (err) {
    console.error('[singe] impossible de charger le modèle .glb, utilisation du singe intégré', err);
  }
}

// Réglages personnels sans recompiler : le fichier config.json du dossier de
// données de l'appli est fusionné dans CONFIG (voir README).
function applyUserConfig(user) {
  if (!user || typeof user !== 'object') return;
  merge(CONFIG, user);
  // Couleurs / style : on reconstruit le singe et les images des objets.
  if (user.colors || user.render) {
    const monkey = new ProceduralMonkey(CONFIG);
    stage.setMonkey(monkey);
    brain.setMonkey(monkey);
    try {
      items.setSprites(renderSprites(CONFIG));
    } catch {
      /* on garde les images actuelles */
    }
  }
  console.info('[singe] réglages personnels chargés');
}

function merge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object')
      merge(target[k], v);
    else if (k in target) target[k] = v;
  }
}

function setHidden(hidden) {
  brain.hidden = hidden;
  stage.setVisible(!hidden);
  for (const el of app.querySelectorAll('.shadow, .emote, .zzz, .items')) el.style.visibility = hidden ? 'hidden' : '';
  if (hidden) {
    input.reset();
    loop.stop();
  } else {
    loop.wake();
  }
}

// -----------------------------------------------------------------------------
//  Messages du processus principal
// -----------------------------------------------------------------------------
api.onInit(async (init) => {
  // Mode développeur (npm run dev) : `pet` est accessible dans la console des
  // DevTools, ex. pet.brain.go('sleep'), pet.brain.go('wave'), pet.config...
  // pet.items.spawnBanana(), pet.brain.go('poop'), pet.brain.poopTimer = 0...
  if (init.debug) window.pet = { brain, stage, world, input, effects, items, config: CONFIG };
  applyUserConfig(init.userConfig);
  applySettings(init.settings);
  if (init.modelUrl) await loadCustomModel(init.modelUrl);
  brain.onWorld(init.world);
  ready = true;
  loop.wake();
  if (init.selftest) {
    const { runSelfTest } = await import('./selftest.js');
    runSelfTest({ brain, items, stage, world, api });
  }
});
api.onWorld((info) => {
  input.shift(brain.onWorld(info));
  stage.refreshPixelRatio();
  loop.wake();
});
api.onSettings(applySettings);
api.onLedges((list) => brain.onLedges(list));
api.onLedgeMove((u) => brain.onLedgeMove(u));
api.onUserIdle((seconds) => brain.setUserIdle(seconds));
api.onVisibility((visible) => setHidden(!visible));
api.onCursor((c) => input.onCursor(c));
api.onCommand((cmd) => {
  if (cmd.type === 'recall') brain.recall(cmd.x, cmd.y);
  if (cmd.type === 'banana') items.spawnBanana();
  if (cmd.type === 'clean') items.cleanAll();
  loop.wake();
});

window.addEventListener('resize', () => {
  stage.refreshPixelRatio();
  loop.wake();
});

stage.setSize(CONFIG.referenceSize);
effects.setSize(CONFIG.referenceSize);
items.setSize(CONFIG.referenceSize);
api.ready();
