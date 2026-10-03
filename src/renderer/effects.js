// =============================================================================
//  effects.js : petits effets en HTML/CSS autour du singe
//   - ombre au sol
//   - "Z z z" quand il dort
//   - bulles d'émotion ("!", "?", "♥", "♪", "✶")
//
//  Tout est animé depuis la boucle de rendu (pas d'animation CSS) : quand le
//  singe ne bouge pas, rien n'est recalculé et le processeur se repose.
// =============================================================================

const EMOTE_DURATION = 1.4; // secondes

export class Effects {
  constructor(container, stage, config) {
    this.stage = stage;
    this.cfg = config;
    this.size = config.referenceSize;

    this.shadow = el('div', 'shadow');
    container.prepend(this.shadow); // derrière le singe
    if (!config.render.shadow) this.shadow.style.display = 'none';

    this.bubble = el('div', 'emote');
    this.bubbleText = el('span');
    this.bubble.appendChild(this.bubbleText);
    container.appendChild(this.bubble);
    this.emoteT = -1;

    this.zzz = [0, 1, 2].map(() => {
      const z = el('div', 'zzz');
      z.textContent = 'z';
      container.appendChild(z);
      return z;
    });
    this.sleeping = false;
    this.zzzT = 0;
    this._head = {};
  }

  setSize(px) {
    this.size = px;
    this.shadow.style.width = `${px * 0.6}px`;
    this.shadow.style.height = `${px * 0.13}px`;
    this.bubble.style.fontSize = `${Math.round(px * 0.2)}px`;
    for (const z of this.zzz) z.style.fontSize = `${Math.round(px * 0.17)}px`;
  }

  emote(text) {
    this.bubbleText.textContent = text;
    this.emoteT = 0;
  }

  setSleeping(on) {
    this.sleeping = on;
    this.zzzT = 0;
    if (!on) for (const z of this.zzz) z.style.opacity = '0';
  }

  /** Une bulle est-elle en cours d'animation ? (impose 60 images/s) */
  isBusy() {
    return this.emoteT >= 0;
  }

  update(dt, brain) {
    const s = this.size;
    const head = this.stage.headScreen(this._head);
    const visible = this.stage.visible;

    // Ombre : sur la surface sous le singe, plus petite et pâle quand il est haut
    if (this.cfg.render.shadow) {
      const ground = brain.world.groundBelow(brain.x, brain.y - 2);
      const h = Math.max(0, ground - brain.y);
      const f = Math.max(0, 1 - h / (s * 2.5));
      const show = visible && f > 0.02 && brain.state !== 'climb';
      this.shadow.style.opacity = show ? (0.32 * f).toFixed(3) : '0';
      if (show) {
        const scale = 0.5 + 0.5 * f;
        const sx = brain.x - s * 0.3;
        const sy = ground - s * 0.065;
        this.shadow.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
      }
    }

    // Bulle d'émotion : apparaît en rebondissant, monte un peu, s'efface
    if (this.emoteT >= 0) {
      this.emoteT += dt;
      const t = this.emoteT;
      if (t >= EMOTE_DURATION || !visible) {
        this.emoteT = -1;
        this.bubble.style.opacity = '0';
      } else {
        const pop = t < 0.18 ? easeOutBack(t / 0.18) : 1;
        const fade = t > EMOTE_DURATION - 0.3 ? (EMOTE_DURATION - t) / 0.3 : 1;
        const x = head.x + s * 0.3;
        const y = head.y - s * 0.55 - t * s * 0.08;
        this.bubble.style.opacity = fade.toFixed(3);
        this.bubble.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
      }
    }

    // Z z z : trois lettres qui montent en grossissant
    if (this.sleeping && visible) {
      this.zzzT += dt;
      this.zzz.forEach((z, i) => {
        const p = (this.zzzT / 2.4 + i / 3) % 1;
        const x = head.x + s * (0.15 + p * 0.3);
        const y = head.y - s * (0.25 + p * 0.55);
        z.style.opacity = Math.sin(Math.PI * p).toFixed(3);
        z.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${(0.6 + p * 0.7).toFixed(3)})`;
      });
    }
  }
}

function el(tag, className) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function easeOutBack(x) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
