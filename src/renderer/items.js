// =============================================================================
//  items.js : les objets qui traînent à l'écran.
//   - les cacas 💩 : posés au sol, on clique dessus pour les nettoyer ;
//   - les bananes 🍌 : tombent du ciel, on les attrape et on les donne au singe.
//
//  Chaque objet est une petite image (dessinée en 3D au démarrage, voir
//  sprites.js) déplacée en CSS. Les objets appartiennent à un écran : ils ne
//  sont visibles que quand le singe est sur cet écran.
//
//  Coordonnées : (x, y) = point de contact au sol (bas de l'objet, au centre).
// =============================================================================

const POOF_DURATION = 0.45; // s : disparition d'un caca nettoyé
const POP_DURATION = 0.25; // s : apparition d'un caca
const SIZE = { banana: 0.55, poop: 0.36 }; // taille de l'image (× taille du singe)
const FALLBACK = { banana: '🍌', poop: '💩' }; // si les images 3D n'ont pas pu être créées

let nextId = 1;
const rand = (a, b) => a + Math.random() * (b - a);

export class Items {
  constructor({ container, stage, world, config }) {
    this.world = world;
    this.cfg = config;
    this.size = config.referenceSize;
    this.list = [];
    this.sprites = null;
    this.onLanded = null; // appelé quand une banane touche le sol : (item) => void

    // Cacas derrière le singe, bananes devant.
    this.back = div('items items-back');
    container.insertBefore(this.back, stage.el);
    this.front = div('items items-front');
    container.appendChild(this.front);
  }

  get k() {
    return this.size / this.cfg.referenceSize;
  }

  setSprites(sprites) {
    this.sprites = sprites;
    for (const it of this.list) this._skin(it);
  }

  setSize(px) {
    this.size = px;
    for (const it of this.list) this._layout(it);
  }

  // ---------------------------------------------------------------------------
  //  Création / suppression
  // ---------------------------------------------------------------------------
  /** Une banane tombe du haut de l'écran (en tournoyant). */
  spawnBanana(x) {
    const w = this.world;
    const s = this.size;
    const it = this._create('banana', x ?? rand(w.minX + s, Math.max(w.minX + s, w.maxX - s)), w.topY - s * 0.2);
    it.state = 'fall';
    it.vx = rand(-40, 40) * this.k;
    it.spin = rand(-5, 5);
    it.rot = rand(-Math.PI, Math.PI);
    return it;
  }

  addPoop(x, y) {
    const it = this._create('poop', x, y);
    it.state = 'rest';
    it.support = { kind: 'floor' };
    return it;
  }

  /** La banane a été donnée au singe : elle disparaît (il la tient en main). */
  consume(it) {
    this._remove(it);
  }

  /** Nettoie un caca (petit nuage d'étoiles). */
  clean(it) {
    if (it.kind !== 'poop' || it.state === 'poof') return false;
    it.state = 'poof';
    it.poofT = 0;
    const sparkle = document.createElement('span');
    sparkle.className = 'sparkle';
    sparkle.textContent = '✨';
    it.el.appendChild(sparkle);
    return true;
  }

  cleanAll() {
    for (const it of this.list) if (it.kind === 'poop') this.clean(it);
  }

  removeBananas() {
    for (const it of this.list.filter((i) => i.kind === 'banana')) this._remove(it);
  }

  // ---------------------------------------------------------------------------
  //  Requêtes
  // ---------------------------------------------------------------------------
  count(kind) {
    return this.list.filter((it) => it.kind === kind && it.state !== 'poof').length;
  }

  /** Depuis combien de temps (s) la plus vieille banane visible attend-elle ? */
  oldestBananaAge() {
    let age = 0;
    for (const it of this.list)
      if (it.kind === 'banana' && this._here(it) && it.state === 'rest') age = Math.max(age, it.age);
    return age;
  }

  /** Après un repas, il est content un moment : les bananes restantes "repartent à zéro". */
  resetBananaAges() {
    for (const it of this.list) if (it.kind === 'banana') it.age = 0;
  }

  nearestBanana(x, y) {
    let best = null;
    let bd = Infinity;
    for (const it of this.list) {
      if (it.kind !== 'banana' || !this._here(it) || it.state === 'drag') continue;
      const d = Math.hypot(it.x - x, it.y - y);
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  /** Objet sous le point (x, y) — les bananes d'abord (elles sont devant). */
  hitTest(x, y) {
    const margin = 6;
    for (const kind of ['banana', 'poop']) {
      for (let i = this.list.length - 1; i >= 0; i--) {
        const it = this.list[i];
        if (it.kind !== kind || !this._here(it) || it.state === 'poof') continue;
        const bottom = this._bottom(it);
        const cy = it.y - it.w * (bottom - 0.5);
        const rx = it.w * 0.45 + margin;
        const ry = it.w * (bottom - 0.5) + margin;
        const dx = (x - it.x) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) return it;
      }
    }
    return null;
  }

  /** Un objet bouge-t-il (chute, glisser, animation) ? → 60 images/s. */
  isBusy() {
    return this.list.some(
      (it) => this._here(it) && (it.state !== 'rest' || (it.kind === 'poop' && it.t < POP_DURATION)),
    );
  }

  // ---------------------------------------------------------------------------
  //  Glisser-déposer d'une banane
  // ---------------------------------------------------------------------------
  grab(it, p) {
    it.state = 'drag';
    it.support = null;
    it.offX = it.x - p.x;
    it.offY = it.y - p.y;
    this.front.appendChild(it.el); // au premier plan
  }

  dragTo(it, p) {
    const w = this.world;
    it.x = Math.min(Math.max(p.x + it.offX, 0), w.width);
    it.y = Math.min(Math.max(p.y + it.offY, 0), w.floorY);
  }

  /** Lâchée ailleurs que sur le singe : elle retombe. */
  release(it, vx, vy) {
    const max = 1500 * this.k;
    it.state = 'fall';
    it.vx = Math.max(-max, Math.min(max, vx * 0.6));
    it.vy = Math.max(-max, Math.min(max, vy * 0.6));
    it.spin = it.vx * 0.01;
    it.bounced = false;
    it.fromUser = true;
  }

  // ---------------------------------------------------------------------------
  //  Animation (appelée à chaque image). `aging` : le temps d'attente des
  //  bananes avance-t-il ? (non si vous êtes absent, en pause...)
  // ---------------------------------------------------------------------------
  update(dt, aging) {
    const w = this.world;
    const g = this.cfg.movement.gravity * this.k;
    for (const it of [...this.list]) {
      it.t += dt;
      const here = this._here(it);
      it.el.style.display = here ? '' : 'none';
      if (!here) continue;

      if (it.state === 'fall') this._fall(it, dt, g);
      else if (it.state === 'rest') {
        // La fenêtre sous l'objet a bougé ou disparu ?
        const sy = w.supportY(it.support);
        if (sy == null || !w.segmentAt(it.support, it.x, 4)) {
          it.state = 'fall';
          it.support = null;
          it.bounced = true;
        } else {
          it.y = sy;
        }
        it.rot *= Math.exp(-dt * 14); // se remet à plat
        if (it.kind === 'banana' && aging) it.age += dt;
      } else if (it.state === 'drag') {
        it.rot = Math.sin(it.t * 9) * 0.15;
      } else if (it.state === 'poof') {
        it.poofT += dt;
        if (it.poofT >= POOF_DURATION) {
          this._remove(it);
          continue;
        }
      }
      this._render(it);
    }
  }

  _fall(it, dt, g) {
    const w = this.world;
    const steps = Math.max(1, Math.ceil(dt * 120));
    const h = dt / steps;
    const half = it.w * 0.4;
    for (let i = 0; i < steps; i++) {
      it.vy += g * h;
      it.vx *= Math.exp(-0.6 * h);
      it.x += it.vx * h;
      it.rot += it.spin * h;
      const y0 = it.y;
      it.y += it.vy * h;
      if (it.x < half || it.x > w.width - half) {
        it.x = Math.min(Math.max(it.x, half), w.width - half);
        it.vx = -it.vx * 0.4;
      }
      if (it.vy <= 0) continue;
      const hit = w.findLanding(it.x, y0, it.y);
      if (!hit) continue;
      it.y = hit.y;
      if (!it.bounced && it.vy > 500 * this.k) {
        // petit rebond
        it.bounced = true;
        it.vy = -it.vy * 0.3;
        it.spin *= 0.5;
        continue;
      }
      it.state = 'rest';
      it.support = hit.support;
      it.vx = it.vy = 0;
      it.age = 0;
      it.rot = Math.atan2(Math.sin(it.rot), Math.cos(it.rot)); // ramené entre -π et π
      this.onLanded?.(it);
      return;
    }
  }

  // ---------------------------------------------------------------------------
  //  Affichage
  // ---------------------------------------------------------------------------
  _create(kind, x, y) {
    const el = div(`item ${kind}`);
    const img = document.createElement('img');
    img.draggable = false;
    img.alt = '';
    el.appendChild(img);
    const it = {
      id: nextId++,
      kind,
      el,
      img,
      x,
      y,
      vx: 0,
      vy: 0,
      rot: 0,
      spin: 0,
      state: 'rest',
      support: null,
      age: 0,
      t: 0,
      displayId: this.world.displayId,
      fromUser: false,
      bounced: false,
      stink: [],
    };
    if (kind === 'poop') {
      // Petites odeurs qui montent
      for (let i = 0; i < 2; i++) {
        const s = document.createElement('span');
        s.className = 'stink';
        s.textContent = '~';
        el.appendChild(s);
        it.stink.push(s);
      }
    }
    (kind === 'poop' ? this.back : this.front).appendChild(el);
    this._skin(it);
    this._layout(it);
    this.list.push(it);
    this._render(it);
    return it;
  }

  _skin(it) {
    const sprite = this.sprites?.[it.kind];
    if (sprite) {
      it.img.src = sprite.url;
      it.img.style.display = '';
      it.el.dataset.emoji = '';
    } else {
      it.img.style.display = 'none';
      it.el.dataset.emoji = FALLBACK[it.kind];
    }
  }

  _layout(it) {
    it.w = this.size * SIZE[it.kind];
    it.el.style.width = it.el.style.height = `${it.w}px`;
    it.el.style.fontSize = `${it.w * 0.7}px`;
  }

  _bottom(it) {
    return this.sprites?.[it.kind]?.bottom ?? 0.8;
  }

  _render(it) {
    const w = it.w;
    const left = it.x - w / 2;
    const top = it.y - w * this._bottom(it);
    let scale = 1;
    let opacity = 1;
    if (it.kind === 'poop' && it.t < POP_DURATION) scale = easeOutBack(it.t / POP_DURATION);
    if (it.state === 'drag') scale = 1.12;
    if (it.state === 'poof') {
      const p = it.poofT / POOF_DURATION;
      scale = 1 + p * 0.5;
      opacity = 1 - p;
    }
    it.el.style.opacity = opacity.toFixed(3);
    it.el.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0) rotate(${it.rot.toFixed(3)}rad) scale(${scale.toFixed(3)})`;

    // Odeurs : deux vaguelettes qui montent et s'estompent
    it.stink.forEach((s, i) => {
      const p = (it.t * 0.5 + i * 0.5) % 1;
      const x = w * (0.42 + (i ? 0.22 : -0.12) + Math.sin(p * 6 + i) * 0.04);
      const y = w * (0.1 - p * 0.45);
      s.style.opacity = it.state === 'rest' ? (Math.sin(Math.PI * p) * 0.75).toFixed(3) : '0';
      s.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(90deg)`;
    });
  }

  _here(it) {
    return it.displayId === this.world.displayId;
  }

  _remove(it) {
    it.el.remove();
    const i = this.list.indexOf(it);
    if (i >= 0) this.list.splice(i, 1);
  }
}

function div(className) {
  const d = document.createElement('div');
  d.className = className;
  return d;
}

function easeOutBack(x) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
