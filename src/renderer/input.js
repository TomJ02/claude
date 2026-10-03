// =============================================================================
//  input.js : souris (survol, clic, glisser-déposer, caresses).
//
//  Clics "traversants" : la fenêtre ignore la souris (les clics vont aux
//  fenêtres en dessous) SAUF quand le curseur est sur le singe. Electron nous
//  transmet quand même les mouvements de souris (option `forward`), ce qui
//  permet de détecter le survol par un lancer de rayon sur le modèle 3D.
// =============================================================================

const HOVER_RECHECK = 0.1; // s : re-test du survol quand c'est le singe qui bouge

export class Input {
  constructor({ stage, brain, world, api, config, wake }) {
    this.stage = stage;
    this.brain = brain;
    this.world = world;
    this.api = api;
    this.cfg = config.cursor;
    this.wake = wake;

    this.cursor = null; // dernière position connue du curseur
    this.hovering = false;
    this.ignoring = true; // état actuel du "click-through"
    this.press = null; // appui en cours sur le singe
    this.dragging = false;
    this.samples = []; // positions récentes (vitesse du lancer)
    this.pet = []; // distances parcourues sur le singe (caresses)
    this.recheck = 0;
    this.lastEdgeRequest = 0;

    window.addEventListener('pointermove', (e) => this.onMove(e), { passive: true });
    window.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e, true));
    document.documentElement.addEventListener('mouseleave', () => this.onLeave());
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.stage.hitTest(e.clientX, e.clientY)) this.api.showMenu();
    });
  }

  onMove(e) {
    const p = { x: e.clientX, y: e.clientY };
    const prev = this.cursor;
    this.cursor = p;

    if (this.press) {
      if (e.buttons === 0) return this.onUp(e); // relâchement manqué
      this.samples.push({ t: performance.now(), x: p.x, y: p.y });
      if (!this.dragging && Math.hypot(p.x - this.press.x, p.y - this.press.y) > this.cfg.dragThreshold) {
        this.beginDrag(p);
      }
      if (this.dragging) {
        this.brain.dragTo(p, this.velocity().vx);
        this.checkScreenEdge(p);
        this.wake();
      }
      return;
    }

    const wasHovering = this.hovering;
    this.updateHover();
    this.brain.onCursor(p);

    // Caresse : le curseur va et vient sur le singe sans cliquer
    if (this.hovering && wasHovering && prev) {
      const now = performance.now();
      this.pet.push({ t: now, d: Math.hypot(p.x - prev.x, p.y - prev.y) });
      while (this.pet.length && now - this.pet[0].t > this.cfg.petWindow * 1000) this.pet.shift();
      const total = this.pet.reduce((s, v) => s + v.d, 0);
      if (total > this.cfg.petDistance * this.stage.size) {
        this.pet = [];
        this.brain.onPet();
      }
    } else {
      this.pet = [];
    }
  }

  onDown(e) {
    if (e.button !== 0 || !this.stage.hitTest(e.clientX, e.clientY)) return;
    e.preventDefault();
    this.press = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.samples = [{ t: this.press.t, x: e.clientX, y: e.clientY }];
    try {
      document.body.setPointerCapture(e.pointerId);
    } catch {
      /* pas grave */
    }
    this.setIgnore(false);
    this.wake();
  }

  onUp(e, cancelled = false) {
    if (!this.press) return;
    const duration = (performance.now() - this.press.t) / 1000;
    const wasDragging = this.dragging;
    this.press = null;
    this.dragging = false;
    document.body.classList.remove('dragging');
    this.api.setDragging(false);
    try {
      document.body.releasePointerCapture(e.pointerId);
    } catch {
      /* pas grave */
    }
    if (wasDragging) {
      const v = this.velocity();
      this.brain.endDrag(v.vx, v.vy);
    } else if (!cancelled && duration <= this.cfg.clickMaxDuration) {
      this.brain.onClick();
    }
    this.cursor = { x: e.clientX, y: e.clientY };
    this.updateHover();
    this.wake();
  }

  onLeave() {
    if (this.press) return;
    this.cursor = null;
    this.updateHover();
    this.brain.onCursor(null);
  }

  beginDrag(p) {
    if (!this.brain.startDrag(p)) return;
    this.dragging = true;
    document.body.classList.add('dragging');
    this.api.setDragging(true);
  }

  // Appelé à chaque image.
  update(dt) {
    // Appui long sans bouger : on le soulève quand même.
    if (this.press && !this.dragging && (performance.now() - this.press.t) / 1000 > this.cfg.clickMaxDuration) {
      this.beginDrag(this.cursor ?? this.press);
    }
    // Le singe bouge sous un curseur immobile : on re-teste le survol.
    this.recheck -= dt;
    if (!this.press && this.cursor && this.recheck <= 0) {
      this.recheck = HOVER_RECHECK;
      this.updateHover();
    }
  }

  updateHover() {
    const hit = !!this.cursor && this.stage.hitTest(this.cursor.x, this.cursor.y);
    if (hit !== this.hovering) {
      this.hovering = hit;
      document.body.classList.toggle('hover', hit);
    }
    this.setIgnore(!(hit || this.press));
  }

  setIgnore(ignore) {
    if (ignore === this.ignoring) return;
    this.ignoring = ignore;
    this.api.setIgnoreMouse(ignore);
  }

  /** Force le mode "click-through" (ex. quand le singe est caché). */
  reset() {
    this.press = null;
    this.dragging = false;
    this.hovering = false;
    document.body.classList.remove('hover', 'dragging');
    this.setIgnore(true);
  }

  /** La fenêtre a changé d'écran : on décale les positions mémorisées. */
  shift({ dx, dy }) {
    if (!dx && !dy) return;
    for (const s of this.samples) {
      s.x += dx;
      s.y += dy;
    }
    if (this.cursor) this.cursor = { x: this.cursor.x + dx, y: this.cursor.y + dy };
  }

  velocity() {
    const now = performance.now();
    const recent = this.samples.filter((s) => now - s.t < 100);
    this.samples = recent.length ? recent : this.samples.slice(-1);
    if (recent.length < 2) return { vx: 0, vy: 0 };
    const a = recent[0];
    const b = recent[recent.length - 1];
    const dt = Math.max(0.016, (b.t - a.t) / 1000);
    return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
  }

  // Pendant un glisser, si le curseur sort de l'écran courant, on demande au
  // processus principal de déplacer la fenêtre sur l'écran voisin.
  checkScreenEdge(p) {
    const w = this.world;
    if (p.x >= 0 && p.y >= 0 && p.x < w.width && p.y < w.height) return;
    const now = performance.now();
    if (now - this.lastEdgeRequest < 250) return;
    this.lastEdgeRequest = now;
    this.api.moveToDisplayAt(w.bounds.x + p.x, w.bounds.y + p.y);
  }
}
