// =============================================================================
//  input.js : souris (survol, clic, glisser-déposer, caresses).
//
//  Clics "traversants" : la fenêtre ignore la souris (les clics vont aux
//  fenêtres en dessous) SAUF quand le curseur est sur le singe ou sur un objet
//  (caca à nettoyer, banane à attraper). Le programme principal (Rust) nous
//  envoie la position du curseur ~60 fois/s même quand la fenêtre laisse
//  passer les clics (onCursor) : on détecte ainsi le survol par un lancer de
//  rayon sur le modèle 3D.
// =============================================================================

const HOVER_RECHECK = 0.1; // s : re-test du survol quand c'est le singe qui bouge

export class Input {
  constructor({ stage, brain, world, items, api, config, wake }) {
    this.stage = stage;
    this.items = items;
    this.brain = brain;
    this.world = world;
    this.api = api;
    this.cfg = config.cursor;
    this.wake = wake;

    this.cursor = null; // dernière position connue du curseur
    this.hovering = false; // curseur sur le singe
    this.hoverItem = null; // curseur sur un objet (caca, banane)
    this.ignoring = true; // état actuel du "click-through"
    this.press = null; // appui en cours sur le singe (ou sur une banane : press.item)
    this.dragging = false;
    this.samples = []; // positions récentes (vitesse du lancer)
    this.pet = []; // distances parcourues sur le singe (caresses)
    this.lastPolled = null; // dernière position reçue du programme principal
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

  // Vrais événements souris : seulement quand la fenêtre ne laisse pas passer
  // les clics (curseur sur le singe, ou pendant un glisser).
  onMove(e) {
    const p = { x: e.clientX, y: e.clientY };
    this.cursor = p;

    if (this.press) {
      if (e.buttons === 0) return this.onUp(e); // relâchement manqué
      this.samples.push({ t: performance.now(), x: p.x, y: p.y });
      if (this.press.item) {
        this.items.dragTo(this.press.item, p);
        this.wake();
        return;
      }
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
    this.updateHover();
  }

  /** Position du curseur envoyée par le programme principal (à tout moment). */
  onCursor({ x, y, inside }) {
    if (this.press) return; // pendant un appui, les vrais événements suffisent
    if (!inside) {
      this.lastPolled = null;
      return this.onLeave();
    }
    const p = { x, y };
    const prev = this.lastPolled;
    this.lastPolled = p;
    this.cursor = p;
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
    if (e.button !== 0) return;
    const p = { x: e.clientX, y: e.clientY };
    const item = this.items.hitTest(p.x, p.y);
    if (!item && !this.stage.hitTest(p.x, p.y)) return;
    e.preventDefault();
    this.setIgnore(false);

    // Clic sur un caca : on le nettoie tout de suite.
    if (item?.kind === 'poop') {
      this.items.clean(item);
      this.brain.onPoopCleaned(item);
      this.cursor = p;
      this.updateHover();
      this.wake();
      return;
    }

    this.press = { x: p.x, y: p.y, t: performance.now(), item };
    this.samples = [{ t: this.press.t, x: p.x, y: p.y }];
    if (item) {
      // On attrape une banane
      this.items.grab(item, p);
      document.body.classList.add('dragging');
    }
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
    if (this.press.item) return this.dropBanana(e);
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

  // Banane lâchée : sur le singe (ou tout près) = donnée, sinon elle retombe.
  dropBanana(e) {
    const it = this.press.item;
    const p = { x: e.clientX, y: e.clientY };
    const v = this.velocity();
    this.press = null;
    document.body.classList.remove('dragging');
    try {
      document.body.releasePointerCapture(e.pointerId);
    } catch {
      /* pas grave */
    }
    const onMonkey = this.stage.hitTest(p.x, p.y) || this.brain.isNear(p);
    if (onMonkey && this.brain.feed()) this.items.consume(it);
    else this.items.release(it, v.vx, v.vy);
    this.cursor = p;
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
    if (
      this.press &&
      !this.press.item &&
      !this.dragging &&
      (performance.now() - this.press.t) / 1000 > this.cfg.clickMaxDuration
    ) {
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
    const c = this.cursor;
    const item = c ? this.items.hitTest(c.x, c.y) : null;
    const hit = !!c && this.stage.hitTest(c.x, c.y);
    this.hovering = hit;
    this.hoverItem = item;
    document.body.classList.toggle('hover', hit || item?.kind === 'banana');
    document.body.classList.toggle('hover-poop', item?.kind === 'poop');
    this.setIgnore(!(hit || item || this.press));
  }

  setIgnore(ignore) {
    if (ignore === this.ignoring) return;
    this.ignoring = ignore;
    this.api.setIgnoreMouse(ignore);
  }

  /** Force le mode "click-through" (ex. quand le singe est caché). */
  reset() {
    if (this.press?.item) this.items.release(this.press.item, 0, 0);
    this.press = null;
    this.dragging = false;
    this.hovering = false;
    this.hoverItem = null;
    document.body.classList.remove('hover', 'hover-poop', 'dragging');
    this.setIgnore(true);
  }

  /** La fenêtre a changé d'écran : on convertit les positions mémorisées. */
  shift(convert) {
    for (const s of this.samples) Object.assign(s, convert(s));
    if (this.cursor) this.cursor = convert(this.cursor);
    this.lastPolled = null;
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
    this.api.moveToDisplayAt(p.x, p.y);
  }
}
