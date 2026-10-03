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

const api = window.petAPI;
const app = document.getElementById('app');

const stage = new Stage(app, CONFIG);
const world = new World();
const effects = new Effects(app, stage, CONFIG);
const loop = createLoop(frame);
const brain = new Brain({
  monkey: new ProceduralMonkey(CONFIG),
  world,
  effects,
  api,
  config: CONFIG,
  wake: loop.wake,
});
stage.setMonkey(brain.m);
const input = new Input({ stage, brain, world, api, config: CONFIG, wake: loop.wake });

let ready = false;

// Une image : cerveau → animation → placement → effets → rendu.
function frame(dt) {
  if (!ready) return 0;
  brain.update(dt);
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

  function tick(now) {
    raf = 0;
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    schedule(step(dt));
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
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      } else {
        last = performance.now();
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
  }
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

function setHidden(hidden) {
  brain.hidden = hidden;
  stage.setVisible(!hidden);
  for (const el of app.querySelectorAll('.shadow, .emote, .zzz')) el.style.visibility = hidden ? 'hidden' : '';
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
  if (init.debug) window.pet = { brain, stage, world, input, effects, config: CONFIG };
  applySettings(init.settings);
  if (init.modelUrl) await loadCustomModel(init.modelUrl);
  brain.onWorld(init.world);
  ready = true;
  loop.wake();
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
api.onCommand((cmd) => {
  if (cmd.type === 'recall') brain.recall(cmd.x, cmd.y);
  loop.wake();
});

window.addEventListener('resize', () => {
  stage.refreshPixelRatio();
  loop.wake();
});

stage.setSize(CONFIG.referenceSize);
effects.setSize(CONFIG.referenceSize);
api.ready();
