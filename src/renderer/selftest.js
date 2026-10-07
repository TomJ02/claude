// =============================================================================
//  selftest.js : auto-test lancé par l'intégration continue (variable
//  d'environnement SINGE_SELFTEST). Joue un petit scénario (atterrissage,
//  banane, repas, caca, nettoyage) et envoie un rapport au programme principal,
//  qui teste ensuite la souris et les fenêtres puis écrit le rapport final.
// =============================================================================
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(test, ms) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    if (test()) return true;
    await wait(50);
  }
  return false;
}

export async function runSelfTest({ brain, items, stage, world, api }) {
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  const r = {};
  try {
    const gl = stage.renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    r.webgl = !gl.isContextLost();
    r.gpu = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    r.sprites = !!items.sprites;
    r.model = brain.m.mixer ? 'glb' : 'intégré'; // seul GltfMonkey a un AnimationMixer
    brain.bananaTimer = brain.poopTimer = 1e9; // pas d'événement aléatoire
    r.landed = await until(() => !!brain.support && brain.state !== 'air', 10000);
    r.world = { width: world.width, height: world.height, floorY: world.floorY, scale: world.scale };

    // Banane : elle tombe, on la lui donne, il la mange
    const banana = items.spawnBanana(Math.min(brain.x + 200, world.width - 100));
    r.bananaLanded = await until(() => banana.state === 'rest', 8000);
    await until(() => ['idle', 'sit', 'walk'].includes(brain.state), 6000);
    r.fed = brain.feed();
    if (r.fed) items.consume(banana);
    r.ate = await until(() => brain.state === 'happy', 8000);

    // Caca, puis nettoyage
    await until(() => brain.state === 'idle', 6000);
    brain.go('idle', { dur: 999 });
    brain.poopTimer = 0;
    r.pooped = await until(() => items.count('poop') === 1, 8000);
    items.cleanAll();
    r.cleaned = await until(() => items.count('poop') === 0, 3000);

    // Cadence d'affichage pendant une marche
    await until(() => brain.state !== 'poop', 4000);
    let frames = 0;
    const orig = stage.render.bind(stage);
    stage.render = () => {
      frames++;
      orig();
    };
    brain.go('walk', { target: brain.x < world.width / 2 ? brain.x + 300 : brain.x - 300 });
    await wait(1000);
    stage.render = orig;
    r.fpsWalking = frames;

    // On l'immobilise au milieu pour le test du survol (fait côté Rust)
    await until(() => brain.state === 'idle', 6000);
    brain.go('idle', { dur: 999 });
    await wait(300);
    const body = { x: brain.x, y: brain.y - brain.size * 0.45 };
    r.monkeyBody = { ...body, global: world.toGlobal(body.x, body.y) };
    r.hitTest = stage.hitTest(body.x, body.y);
    r.state = brain.state;
  } catch (err) {
    errors.push(String(err?.stack ?? err));
  }
  r.errors = errors;
  await api.report(r);
}
