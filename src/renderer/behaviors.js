// =============================================================================
//  behaviors.js : le "cerveau" du singe (machine à états).
//
//  Le singe est toujours dans UN état (idle, walk, sit, sleep...). Chaque état
//  a trois fonctions optionnelles :
//      enter(b, d)       à l'entrée (b = le cerveau, d = données de l'état)
//      update(b, dt, d)  à chaque image (dt en secondes)
//      exit(b, d)        à la sortie
//  On change d'état avec b.go('nom', { ...données }).
//
//  Pour changer la FRÉQUENCE des activités, les vitesses ou les durées,
//  modifiez plutôt config.js. Pour ajouter un comportement : ajoutez un état
//  dans STATES et une entrée dans decide().
//
//  Position : (x, y) = point entre les pieds, en pixels de l'écran courant.
//
//  Le "jeu" (caca, bananes, bêtises) est géré en bas de la classe Brain :
//  _updateGame(), _updateMood(), mischief(), feed().
// =============================================================================
import { FLOOR } from './world.js';

const rand = (a, b) => a + Math.random() * (b - a);
const range = (r) => rand(r[0], r[1]);
const chance = (p) => Math.random() < p;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sign = (v) => (v < 0 ? -1 : 1);

function weightedPick(options) {
  let total = 0;
  for (const [, w] of options) total += Math.max(0, w);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const [name, w] of options) {
    r -= Math.max(0, w);
    if (r <= 0) return name;
  }
  return null;
}

// États "calmes" (au sol, éveillé) : on peut les interrompre (pause, poursuite...).
const CALM = new Set(['idle', 'walk', 'sit', 'scratch', 'wave', 'happy', 'follow', 'beg']);
// États qui ont besoin de 60 images/s.
const ACTIVE = new Set([
  'walk',
  'follow',
  'jump',
  'air',
  'land',
  'dragged',
  'climb',
  'transfer',
  'wave',
  'scratch',
  'happy',
  'dizzy',
  'yawn',
  'poop',
  'eat',
  'angry',
  'beg',
  'type',
  'shove',
]);

// =============================================================================
//  Les états
// =============================================================================
const STATES = {
  // Debout, regarde autour de lui, puis choisit une nouvelle activité.
  idle: {
    enter(b, d) {
      b.m.play('idle');
      b.m.setCycleRate(0);
      b.m.setFacing(b.dir * 0.25);
      b.vx = 0;
      d.dur ??= range(b.cfg.durations.idle);
    },
    update(b, dt, d) {
      if (b.paused) return b.go('paused');
      if (b.userAway()) return b.go('sit');
      b.idleLookAround(dt, d);
      if (b.t >= d.dur) b.decide();
    },
  },

  // Marche jusqu'à d.target. Options : d.speed ('walkSpeed' | 'followSpeed'),
  // d.then (fonction appelée à l'arrivée), d.crossing (-1/1 : part sur l'écran voisin).
  walk: {
    enter(b) {
      b.m.play('walk');
    },
    update(b, dt, d) {
      if (b.paused && !d.crossing) return b.go('paused');
      let target = d.target;
      if (!d.crossing) {
        const r = b.walkRange();
        if (!r) return b.fall();
        target = clamp(target, r[0], r[1]);
      }
      const arrived = b.moveToward(target, b.speed(d.speed ?? 'walkSpeed'), dt);
      b.drain(b.cfg.energy.drainWalk * dt);
      if (d.crossing && (b.x < 0 || b.x > b.world.width)) return b.go('transfer', { side: d.crossing });
      if (arrived) {
        if (d.then) return d.then();
        b.go('idle', { dur: range(b.cfg.durations.pauseBetweenSteps) });
      }
    },
  },

  // Assis (par terre, ou sur un rebord avec les jambes dans le vide).
  sit: {
    enter(b, d) {
      b.m.play(b.onLedge() ? 'sitLedge' : 'sit', { blend: 0.35 });
      b.m.setFacing(0);
      b.m.setCycleRate(0);
      b.vx = 0;
      d.dur ??= range(b.cfg.durations.sit);
    },
    update(b, dt, d) {
      if (b.paused) return b.go('paused');
      if (b.userAway() && b.t > 1) return b.go('yawn', { next: 'sleep', reason: 'user' });
      if (b.energy < b.cfg.energy.sleepBelow && b.t > 3 && chance(dt * 0.2)) {
        return b.go('yawn', { next: 'sleep', reason: 'tired' });
      }
      b.idleLookAround(dt, d);
      if (b.t >= d.dur) {
        if (chance(0.25)) return b.go('scratch', { seated: true });
        b.go('idle');
      }
    },
  },

  // Bâillement (avant de dormir ou au réveil).
  yawn: {
    enter(b, d) {
      b.m.play('yawn', { blend: 0.35 });
      b.m.setFacing(0);
      d.dur = range(b.cfg.durations.yawn);
    },
    update(b, dt, d) {
      if (b.t >= d.dur) b.go(d.next ?? 'idle', { reason: d.reason });
    },
  },

  // Dort. d.reason = 'user' (vous êtes absent) ou 'tired' (plus d'énergie).
  sleep: {
    enter(b, d) {
      b.m.play('sleep', { blend: 0.7 });
      b.m.setFacing(0);
      b.fx.setSleeping(true);
      d.dur = range(b.cfg.durations.sleep);
      d.wakeAt = null;
    },
    exit(b) {
      b.fx.setSleeping(false);
    },
    update(b, dt, d) {
      if (d.reason === 'user') {
        if (b.userIdle < 3 && d.wakeAt == null) d.wakeAt = b.t + range(b.cfg.sleep.wakeDelay);
        if (d.wakeAt != null && b.t >= d.wakeAt) b.wakeUp();
      } else if (b.t >= d.dur && b.energy > 0.9 && !b.userAway() && !b.paused) {
        b.wakeUp();
      }
    },
  },

  // Se gratte la tête (debout ou assis).
  scratch: {
    enter(b, d) {
      b.m.play(d.seated ? 'scratchSit' : 'scratch');
      b.m.setFacing(0);
      b.fx.emote('?');
      d.dur = range(b.cfg.durations.scratch);
    },
    update(b, dt, d) {
      if (b.t >= d.dur) b.go(d.seated ? 'sit' : 'idle', d.seated ? { dur: rand(2, 5) } : {});
    },
  },

  // Fait coucou.
  wave: {
    enter(b, d) {
      b.m.play('wave');
      b.m.setFacing(0);
      b.vx = 0;
      d.dur = range(b.cfg.durations.wave);
    },
    update(b, dt, d) {
      if (b.t >= d.dur) b.go(b.paused ? 'paused' : 'idle');
    },
  },

  // Content (on l'a caressé).
  happy: {
    enter(b, d) {
      b.m.play('happy');
      b.m.setFacing(0);
      b.vx = 0;
      d.dur = range(b.cfg.durations.happy);
    },
    update(b, dt, d) {
      if (b.t >= d.dur) b.go(b.paused ? 'paused' : 'idle');
    },
  },

  // Prépare un saut (accroupi) puis s'élance. d.height (px), d.vx (px/s),
  // d.ignoreLedge (ne pas se rattraper au rebord de départ), d.startled.
  jump: {
    enter(b) {
      b.m.play('crouch', { blend: 0.1 });
      b.vx = 0;
    },
    update(b, dt, d) {
      if (b.t < 0.16) return;
      const h = d.height ?? b.cfg.movement.hopHeight * b.size;
      b.vy = -Math.sqrt(2 * b.gravity * h);
      b.vx = d.vx ?? 0;
      if (d.vx) {
        b.dir = sign(d.vx);
        b.m.setFacing(b.dir);
      }
      b.drain(b.cfg.energy.drainJump);
      const ignore = d.ignoreLedge && b.support?.kind === 'ledge' ? b.support.id : null;
      b.support = null;
      b.go('air', { ignoreLedge: ignore, flail: !!d.startled, voluntary: true });
    },
  },

  // Dans les airs (saut, chute, lancer) : gravité jusqu'à toucher une surface.
  air: {
    enter(b, d) {
      b.support = null;
      b.m.play(d.flail ? 'fall' : 'air', { blend: 0.12 });
      b.m.setCycleRate(0);
    },
    update(b, dt, d) {
      if (!d.flail && b.vy > 900 * b.k) {
        d.flail = true;
        b.m.play('fall', { blend: 0.2 });
      }
      const hit = b.integrateAir(dt, d.ignoreLedge);
      if (hit) {
        b.support = hit.support;
        b.y = hit.y;
        b.vx = b.vy = 0;
        b.go('land', { impact: hit.impact, greet: d.greet, voluntary: d.voluntary });
      }
    },
  },

  // Atterrissage (écrasement). Étourdi après une chute violente qu'il n'a pas
  // choisie (lâché de haut, lancé, fenêtre disparue sous ses pieds).
  land: {
    enter(b, d) {
      b.m.play('land', { blend: 0.05, restart: true });
      b.m.setFacing(b.dir * 0.25);
      d.hard = !d.greet && !d.voluntary && d.impact > b.cfg.movement.hardLandingSpeed * b.k;
      if (d.hard) b.fx.emote('✶');
    },
    update(b, dt, d) {
      if (b.t < 0.45) return;
      if (d.hard) return b.go('dizzy');
      if (d.greet) {
        b.fx.emote('♥');
        return b.go('wave'); // arrivée : petit coucou
      }
      // Arrivé sur la fenêtre qu'il voulait bousculer ?
      const shove = b.pendingShove;
      b.pendingShove = null;
      if (shove && b.onLedge() && b.support.id === shove && b.mood === 'angry') {
        return b.go('shove', { ledgeId: shove });
      }
      b.go(b.paused ? 'paused' : 'idle');
    },
  },

  dizzy: {
    enter(b, d) {
      b.m.play('dizzy');
      b.m.setFacing(0);
      d.dur = range(b.cfg.durations.dizzy);
    },
    update(b, dt, d) {
      if (b.t >= d.dur) b.go(b.paused ? 'paused' : 'idle');
    },
  },

  // Suit le curseur le long de sa surface, puis fait parfois coucou.
  follow: {
    enter(b, d) {
      b.m.play('walk');
      d.close = 0;
    },
    update(b, dt, d) {
      const F = b.cfg.cursor;
      const c = b.cursor;
      if (b.paused) return b.go('paused');
      if (!c || b.t > F.followMaxDuration || Math.hypot(c.x - b.x, c.y - b.y) > F.followGiveUp * b.k) {
        return b.go('idle');
      }
      const r = b.walkRange();
      if (!r) return b.fall();
      const target = clamp(c.x, r[0], r[1]);
      if (Math.abs(target - b.x) > b.size * 0.3) {
        d.close = 0;
        b.m.play('walk');
        b.moveToward(target, b.speed('followSpeed'), dt);
        b.drain(b.cfg.energy.drainWalk * dt);
      } else {
        b.vx = 0;
        b.m.play('idle');
        b.m.setFacing(0);
        d.close += dt;
        if (d.close > 1.2) {
          if (chance(0.6)) {
            b.fx.emote('♥');
            return b.go('wave');
          }
          return b.go('idle');
        }
      }
    },
  },

  // Grimpe (de dos) jusqu'au rebord d.ledgeId.
  climb: {
    enter(b) {
      b.support = null;
      b.vx = b.vy = 0;
      b.m.setFacing('back');
      b.m.play('climb', { blend: 0.25 });
    },
    update(b, dt, d) {
      const l = b.world.ledges.get(d.ledgeId);
      if (!l || l.y > b.y + 2 || !l.segs.some(([a, c]) => b.x >= a - 2 && b.x <= c + 2)) return b.fall();
      const v = b.speed('climbSpeed');
      b.y -= v * dt;
      b.m.setCycleRate((v / (0.32 * b.size)) * 2 * Math.PI);
      b.drain(b.cfg.energy.drainClimb * dt);
      if (b.y <= l.y) {
        b.y = l.y;
        b.support = { kind: 'ledge', id: l.id };
        b.m.setFacing(0);
        b.fx.emote(chance(0.5) ? '♪' : '!');
        b.go('land', { impact: 0 });
      }
    },
  },

  // Porté par la souris : suit le curseur et se balance comme un pendule.
  dragged: {
    enter(b, d) {
      b.support = null;
      b.vx = b.vy = 0;
      b.m.setFacing(0);
      b.m.play('dragged', { blend: 0.15 });
      d.swing = 0;
      d.swingV = 0;
      b.fx.emote(chance(0.5) ? '!' : '♪');
    },
    exit(b) {
      b.m.setSwing(0);
    },
    update(b, dt, d) {
      const g = b.grab;
      if (!g) return;
      // On le tient progressivement par la nuque.
      const k = 1 - Math.exp(-dt * 12);
      g.offX += (0 - g.offX) * k;
      g.offY += (b.size * 0.775 - g.offY) * k;
      b.x = g.cursor.x + g.offX;
      b.y = Math.min(g.cursor.y + g.offY, b.world.floorY); // pas sous la barre des tâches
      // Pendule amorti : les pieds traînent derrière le mouvement.
      const target = clamp(-g.vx * 0.0006, -0.75, 0.75);
      d.swingV += ((target - d.swing) * 70 - d.swingV * 7) * dt;
      d.swing += d.swingV * dt;
      b.m.setSwing(d.swing);
    },
  },

  // En train de passer sur l'écran voisin (on attend la réponse du processus principal).
  transfer: {
    enter(b, d) {
      const w = b.world;
      b.api.moveToDisplayAt(w.bounds.x + b.x + d.side * 4, w.bounds.y + b.y - b.size * 0.5);
    },
    update(b, dt, d) {
      if (b.t > 1.5) {
        // Pas de réponse : demi-tour.
        b.x = clamp(b.x, b.world.minX + 1, b.world.maxX - 1);
        b.go('walk', { target: b.x - d.side * b.size * 2 });
      }
    },
  },

  // ---------------------------------------------------------------------------
  //  Jeu : caca, bananes, colère et bêtises
  // ---------------------------------------------------------------------------

  // Fait caca (accroupi), le dépose derrière lui, puis s'éloigne l'air de rien.
  poop: {
    enter(b, d) {
      b.m.play('poop', { blend: 0.3 });
      b.m.setFacing(0);
      b.vx = 0;
      d.dur = 2.6;
      d.done = false;
    },
    update(b, dt, d) {
      if (!d.done && b.t >= 1.7) {
        d.done = true;
        b.items.addPoop(b.x, b.y);
        b.fx.emote('💩');
      }
      if (b.t >= d.dur) {
        const dir = chance(0.5) ? 1 : -1;
        b.go('walk', { target: b.x + dir * rand(1.3, 2.5) * b.size });
      }
    },
  },

  // Mange la banane qu'on lui a donnée (elle diminue dans sa main).
  eat: {
    enter(b, d) {
      b.m.play('eat', { blend: 0.25 });
      b.m.setFacing(0);
      b.m.setProp('banana', 1);
      b.vx = 0;
      b.fx.emote('😋');
      d.dur = b.cfg.game.eatDuration;
    },
    exit(b) {
      b.m.setProp('banana', 0);
    },
    update(b, dt, d) {
      b.m.setProp('banana', Math.max(0.05, 1 - b.t / d.dur));
      if (b.t >= d.dur) {
        b.fx.emote('♥');
        b.go('happy');
      }
    },
  },

  // Réclame la banane qui traîne : la montre du doigt en sautillant.
  beg: {
    enter(b, d) {
      d.target = b.items.nearestBanana(b.x, b.y);
      if (d.target) b.dir = sign(d.target.x - b.x);
      b.m.setFacing(b.dir * 0.7);
      b.m.play('beg');
      b.vx = 0;
      b.fx.emote(b.mood === 'ok' ? '🍌' : '🍌?');
      d.dur = 1.8;
    },
    update(b, dt, d) {
      if (b.t >= d.dur) b.go(b.paused ? 'paused' : 'idle');
    },
  },

  // Colère : il trépigne, puis passe éventuellement à une bêtise (d.next).
  angry: {
    enter(b, d) {
      b.m.play('angry');
      b.m.setFacing(0);
      b.vx = 0;
      b.fx.emote(chance(0.5) ? '💢' : '🍌!!');
      d.dur = 1.6;
    },
    update(b, dt, d) {
      if (b.t < d.dur) return;
      if (d.next === 'note' && b.game.prankNotes) return b.go('type');
      if (d.next === 'window' && d.here && b.game.prankWindows && b.support?.id === d.here) {
        return b.go('shove', { ledgeId: d.here });
      }
      if (d.next === 'window' && d.shove && b.game.prankWindows && b.support?.kind === 'floor') {
        b.pendingShove = d.shove.ledgeId;
        return b.startClimb(d.shove);
      }
      b.go(b.paused ? 'paused' : 'idle');
    },
  },

  // Bêtise n°1 : debout sur une fenêtre, il trépigne et la fait glisser.
  shove: {
    enter(b, d) {
      b.m.play('angry');
      b.m.setFacing(0);
      b.vx = 0;
      b.fx.emote('💢');
      d.dur = 2.4;
      const move = b.planWindowShove(d.ledgeId);
      if (move) b.api.prank({ type: 'move-window', id: d.ledgeId, dx: move.dx, dy: move.dy });
    },
    update(b, dt, d) {
      if (b.t >= d.dur) b.go('idle');
    },
  },

  // Bêtise n°2 : il "tape" une note, puis elle s'ouvre : "DONNE BANANES !!".
  type: {
    enter(b, d) {
      b.m.play('type');
      b.m.setFacing(0);
      b.vx = 0;
      b.fx.emote('📝');
      d.dur = 2;
    },
    update(b, dt, d) {
      if (b.t < d.dur) return;
      if (b.game.prankNotes) {
        b.lastNoteAt = b.clock;
        b.notesWritten++;
        b.api.prank({ type: 'note', count: b.notesWritten });
        b.fx.emote('😤');
      }
      b.go(b.paused ? 'paused' : 'idle');
    },
  },

  // Pause (menu de la zone de notification) : reste assis sans bouger.
  paused: {
    enter(b) {
      b.m.play(b.onLedge() ? 'sitLedge' : 'sit', { blend: 0.4 });
      b.m.setFacing(0);
      b.m.setCycleRate(0);
      b.vx = 0;
    },
    update(b) {
      if (!b.paused) b.go('idle');
    },
  },
};

// =============================================================================
//  Le cerveau
// =============================================================================
export class Brain {
  constructor({ monkey, world, effects, items, api, config, wake }) {
    this.m = monkey;
    this.world = world;
    this.fx = effects;
    this.items = items;
    this.api = api;
    this.cfg = config;
    this.wake = wake ?? (() => {});

    this.size = config.referenceSize;
    this.speedMul = 1;
    this.paused = false;
    this.climbEnabled = true;
    this.hidden = false;

    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.dir = 1;
    this.support = null; // FLOOR | { kind: 'ledge', id } | null (en l'air)
    this.energy = config.energy.start;
    this.userIdle = 0;
    this.cursor = null;
    this.cursorNear = false;
    this.looking = false;
    this.idleLook = null;
    this.followCooldown = 0;
    this.grab = null;
    this.trackedId = null;

    this.state = 'air';
    this.t = 0;
    this.d = {};

    // Jeu (voir config.js > game, et le menu "Jeu")
    const G = config.game;
    this.game = { poop: true, bananas: true, prankWindows: true, prankNotes: true };
    this.clock = 0; // temps écoulé (s)
    this.gameActive = false; // les minuteries du jeu avancent-elles ?
    this.poopTimer = range(G.poopEvery);
    this.bananaTimer = range(G.bananaEvery) * 0.5; // la première banane arrive plus vite
    this.mood = 'ok'; // 'ok' | 'annoyed' (il réclame) | 'angry' (il fait des bêtises)
    this.begTimer = 0;
    this.mischiefTimer = 0;
    this.lastMischief = null;
    this.lastNoteAt = -Infinity;
    this.notesWritten = 0;
    this.pendingShove = null; // fenêtre qu'il compte bousculer une fois dessus
  }

  // ---------------------------------------------------------------------------
  //  Boucle
  // ---------------------------------------------------------------------------
  go(name, data = {}) {
    STATES[this.state]?.exit?.(this, this.d);
    this.state = name;
    this.t = 0;
    this.d = data;
    STATES[name].enter?.(this, data);
    this.wake();
  }

  update(dt) {
    if (this.hidden || this.world.displayId == null) return;
    this.t += dt;
    this.followCooldown = Math.max(0, this.followCooldown - dt);
    this.clock += dt;
    this._regen(dt);
    if (this.support && !this.checkSupport()) return; // le sol s'est dérobé : il tombe
    this._updateGame(dt);
    STATES[this.state].update?.(this, dt, this.d);
    this._updateLook();
    this._syncTracking();
  }

  /** Images par seconde souhaitées (0 = on peut arrêter de dessiner). */
  desiredFps() {
    const r = this.cfg.render;
    if (this.hidden) return 0;
    if (ACTIVE.has(this.state) || !this.m.isSettled() || this.fx.isBusy() || this.items.isBusy()) return r.fpsActive;
    if (this.state === 'sleep') return r.fpsSleep;
    if (this.state === 'paused') return 0;
    if (this.looking) return r.fpsActive;
    return r.fpsCalm;
  }

  // ---------------------------------------------------------------------------
  //  Choix de la prochaine activité
  // ---------------------------------------------------------------------------
  decide() {
    const W = this.cfg.weights;
    const e = this.energy;
    const onFloor = this.support?.kind === 'floor';
    const climb = onFloor && this.climbEnabled ? this.pickClimb() : null;
    const exploreSide = onFloor ? this.pickExploreSide() : 0;

    const choice = weightedPick([
      ['walk', W.walk * e],
      ['sit', W.sit * (0.3 + (1 - e))],
      ['scratch', W.scratch],
      ['wave', W.wave],
      ['hop', W.hop * e],
      ['climb', climb ? W.climb * e : 0],
      ['jumpDown', this.onLedge() ? W.jumpDown * (0.4 + (1 - e)) : 0],
      ['explore', exploreSide ? W.explore * e : 0],
      ['beg', this.game.bananas && this.items.nearestBanana(this.x, this.y) ? 2 : 0],
    ]);

    switch (choice) {
      case 'walk':
        return this.go('walk', { target: this.pickWalkTarget() });
      case 'sit':
        return this.go('sit');
      case 'scratch':
        return this.go('scratch');
      case 'wave':
        return this.go('wave');
      case 'hop':
        return this.go('jump', { vx: chance(0.5) ? this.dir * 60 * this.k : 0 });
      case 'climb':
        return this.startClimb(climb);
      case 'jumpDown': {
        const dir = chance(0.5) ? 1 : -1;
        return this.go('jump', {
          vx: dir * this.cfg.movement.jumpDownSpeed * this.k,
          height: this.size * 0.25,
          ignoreLedge: true,
        });
      }
      case 'beg':
        return this.go('beg');
      case 'explore': {
        const target = exploreSide < 0 ? -this.size : this.world.width + this.size;
        return this.go('walk', { target, crossing: exploreSide });
      }
      default:
        return this.go('idle');
    }
  }

  pickWalkTarget() {
    const r = this.walkRange();
    if (!r) return this.x;
    const [a, b] = r;
    for (let i = 0; i < 8; i++) {
      const tx = this.x + rand(0.8, 5) * this.size * (chance(0.5) ? 1 : -1);
      if (tx >= a && tx <= b) return tx;
    }
    return rand(a, b);
  }

  pickClimb() {
    const list = this.world.climbableLedges(this.size, this.cfg.windows);
    if (!list.length) return null;
    const { ledge, segs } = list[Math.floor(Math.random() * list.length)];
    const [a, b] = segs[Math.floor(Math.random() * segs.length)];
    const margin = this.size * 0.3;
    return { ledgeId: ledge.id, x: rand(a + margin, b - margin) };
  }

  startClimb(c) {
    this.go('walk', {
      target: c.x,
      ledgeId: c.ledgeId,
      then: () => {
        const l = this.world.ledges.get(c.ledgeId);
        if (!l || !l.segs.some(([a, b]) => this.x >= a && this.x <= b)) return this.go('idle');
        const height = this.y - l.y;
        if (height <= this.cfg.windows.jumpUpMaxHeight * this.size) {
          return this.go('jump', { height: height + this.size * 0.35 });
        }
        this.go('climb', { ledgeId: c.ledgeId });
      },
    });
  }

  pickExploreSide() {
    const w = this.world;
    const midY = this.y - this.size * 0.5;
    const sides = [];
    if (w.workArea.x <= 1 && w.hasNeighbor(-1, midY)) sides.push(-1);
    if (w.workArea.x + w.workArea.width >= w.width - 1 && w.hasNeighbor(1, midY)) sides.push(1);
    return sides.length ? sides[Math.floor(Math.random() * sides.length)] : 0;
  }

  // ---------------------------------------------------------------------------
  //  Déplacements et physique
  // ---------------------------------------------------------------------------
  get k() {
    return this.size / this.cfg.referenceSize; // facteur d'échelle lié à la taille
  }
  get gravity() {
    return this.cfg.movement.gravity * this.k;
  }
  /** Vitesse (px/s) mise à l'échelle de la taille et du réglage "Vitesse". */
  speed(name) {
    return this.cfg.movement[name] * this.k * this.speedMul;
  }

  onLedge() {
    return this.support?.kind === 'ledge';
  }

  /** Intervalle [xMin, xMax] où il peut marcher sur sa surface actuelle. */
  walkRange() {
    const s = this.support;
    if (!s) return null;
    const seg = this.world.segmentAt(s, this.x, this.size * 0.12);
    if (!seg) return null;
    const m = s.kind === 'floor' ? this.size * 0.35 : this.size * 0.15;
    let a = seg[0] + m;
    let b = seg[1] - m;
    if (a > b) a = b = (seg[0] + seg[1]) / 2;
    return [a, b];
  }

  /** Avance vers `target` avec accélération/freinage. Retourne true à l'arrivée. */
  moveToward(target, maxSpeed, dt) {
    const dist = target - this.x;
    const ad = Math.abs(dist);
    if (ad < 0.5) {
      this.x = target;
      this.vx = 0;
      return true;
    }
    const acc = this.cfg.movement.acceleration * this.k;
    let v = sign(this.vx) === sign(dist) ? Math.abs(this.vx) : 0; // demi-tour : repart de zéro
    const want = Math.min(maxSpeed, Math.sqrt(2 * acc * ad));
    v = v < want ? Math.min(want, v + acc * dt) : want;
    v = Math.max(v, Math.min(maxSpeed, 10 * this.k));
    const step = Math.min(ad, v * dt);
    this.x += sign(dist) * step;
    this.vx = sign(dist) * v;
    this.dir = sign(dist);
    this.m.setFacing(this.dir);
    // Cadence des pas proportionnelle à la vitesse : les pieds ne glissent pas.
    this.m.setCycleRate((v / (0.42 * this.size)) * 2 * Math.PI);
    return step >= ad;
  }

  /** Vérifie que la surface sous ses pieds existe encore ; sinon il tombe. */
  checkSupport() {
    const s = this.support;
    if (!s) return false;
    const y = this.world.supportY(s);
    if (y == null || !this.world.segmentAt(s, this.x, this.size * 0.12)) {
      this.fall();
      return false;
    }
    this.y = y;
    return true;
  }

  fall() {
    this.support = null;
    this.vy = Math.max(this.vy, 0);
    this.go('air', { flail: true });
  }

  /** Intègre la chute ; retourne { support, y, impact } à l'atterrissage. */
  integrateAir(dt, ignoreId) {
    const M = this.cfg.movement;
    const steps = Math.max(1, Math.ceil(dt * 120));
    const h = dt / steps;
    const half = this.size * 0.3;
    for (let i = 0; i < steps; i++) {
      this.vy += this.gravity * h;
      this.vx *= Math.exp(-M.airDrag * h);
      this.x += this.vx * h;
      const y0 = this.y;
      this.y += this.vy * h;
      // Bords de l'écran : il rebondit
      if (this.x < half) {
        this.x = half;
        this.vx = Math.abs(this.vx) * M.wallBounce;
      } else if (this.x > this.world.width - half) {
        this.x = this.world.width - half;
        this.vx = -Math.abs(this.vx) * M.wallBounce;
      }
      if (this.vy < 0 && this.y - this.size < 0) {
        this.y = this.size;
        this.vy = -this.vy * 0.3;
      }
      if (this.vy > 0) {
        const hit = this.world.findLanding(this.x, y0, this.y, ignoreId);
        if (hit) return { ...hit, impact: this.vy };
      }
    }
    return null;
  }

  drain(amount) {
    this.energy = clamp(this.energy - amount, 0, 1);
  }

  _regen(dt) {
    const E = this.cfg.energy;
    const s = this.state;
    const rate =
      s === 'sleep'
        ? E.regenSleep
        : s === 'sit' || s === 'paused' || s === 'yawn'
          ? E.regenSit
          : s === 'idle'
            ? E.regenIdle
            : 0;
    this.energy = clamp(this.energy + rate * dt, 0, 1);
  }

  userAway() {
    return this.userIdle >= this.cfg.sleep.afterUserIdle;
  }

  wakeUp() {
    this.go('yawn', { next: this.paused ? 'paused' : 'idle' });
  }

  // ---------------------------------------------------------------------------
  //  Regard
  // ---------------------------------------------------------------------------
  idleLookAround(dt, d) {
    d.lookT = (d.lookT ?? rand(0.5, 1.5)) - dt;
    if (d.lookT <= 0) {
      d.lookT = rand(1, 2.5);
      this.idleLook = chance(0.55) ? { dx: rand(-350, 350), dy: rand(-120, 60) } : null;
    }
  }

  _updateLook() {
    const c = this.cursor;
    const headY = this.y - this.size * 0.72;
    let target = null;
    if (c && !this.paused && Math.hypot(c.x - this.x, c.y - headY) < this.cfg.cursor.lookRadius * this.k) {
      target = { dx: c.x - this.x, dy: c.y - headY };
    }
    this.looking = !!target;
    // Quand il réclame, il fixe la banane
    const banana = this.state === 'beg' ? this.d.target : null;
    if (banana && this.items.list.includes(banana)) target = { dx: banana.x - this.x, dy: banana.y - headY };
    if (!target && this.idleLook && (this.state === 'idle' || this.state === 'sit')) target = this.idleLook;
    if (target) this.m.setLookTarget(target.dx, target.dy);
    else this.m.setLookTarget(null);
  }

  // Demande au processus principal de suivre de près la fenêtre sur laquelle il est.
  _syncTracking() {
    let id = null;
    if (this.support?.kind === 'ledge') id = this.support.id;
    else if (this.state === 'climb' || (this.state === 'walk' && this.d.ledgeId)) id = this.d.ledgeId;
    if (id !== this.trackedId) {
      this.trackedId = id;
      this.api.trackWindow(id);
    }
  }

  // ---------------------------------------------------------------------------
  //  Événements venant de l'extérieur (souris, menu, processus principal)
  // ---------------------------------------------------------------------------
  setMonkey(monkey) {
    this.m = monkey;
    STATES[this.state].enter?.(this, this.d);
  }

  setSize(px) {
    this.size = px;
  }

  setPaused(paused) {
    this.paused = paused;
    if (paused && CALM.has(this.state)) this.go('paused');
    else if (!paused && this.state === 'paused') this.go('idle');
    this.wake();
  }

  setClimbEnabled(on) {
    this.climbEnabled = on;
    if (!on) {
      this.world.setLedges([]);
      if (this.onLedge() || this.state === 'climb') this.fall();
    }
  }

  setUserIdle(seconds) {
    const wasAway = this.userAway();
    this.userIdle = seconds;
    if (wasAway !== this.userAway()) this.wake();
  }

  /** Nouvelles infos d'écran. Retourne le décalage appliqué aux coordonnées. */
  onWorld(info) {
    const w = this.world;
    const first = w.displayId == null;
    const old = { ...w.bounds };
    const changedDisplay = w.displayId !== info.displayId;
    w.setDisplay(info);
    if (first) {
      this.spawn();
      return { dx: 0, dy: 0 };
    }
    const dx = old.x - info.bounds.x;
    const dy = old.y - info.bounds.y;
    this.x += dx;
    this.y += dy;
    if (this.grab) {
      this.grab.cursor.x += dx;
      this.grab.cursor.y += dy;
    }
    if (changedDisplay) w.setLedges([]);
    if (this.state === 'dragged') return { dx, dy };

    if (this.state === 'transfer') {
      const side = this.d.side;
      if (this.y < w.floorY - 2) {
        this.support = null;
        this.vx = side * this.speed('walkSpeed');
        this.go('air', {});
      } else {
        this.y = w.floorY;
        this.support = FLOOR;
        this.go('walk', { target: this.x + side * rand(1.5, 4) * this.size });
      }
    } else {
      // L'écran a changé de taille / de disposition : on le garde bien visible.
      this.x = clamp(this.x, this.size * 0.3, w.width - this.size * 0.3);
      if (this.support) this.checkSupport();
    }
    this.wake();
    return { dx, dy };
  }

  onLedges(list) {
    if (!this.climbEnabled) return;
    this.world.setLedges(list);
    this.wake();
  }

  /** Mise à jour rapide de la fenêtre suivie (il se déplace avec elle). */
  onLedgeMove(u) {
    const res = this.world.moveLedge(u);
    if (!res) return;
    if (res.gone) {
      if (this.onLedge() && this.support.id === u.id) this.fall();
      return;
    }
    const onIt = this.onLedge() && this.support.id === u.id;
    if (onIt || (this.state === 'climb' && this.d.ledgeId === u.id)) this.x += res.dx;
    if (onIt) this.y = u.y;
    if (this.state === 'walk' && this.d.ledgeId === u.id) this.d.target += res.dx;
    this.wake();
  }

  /** Apparition : tombe du haut de l'écran, atterrit et dit bonjour. */
  spawn(x) {
    const w = this.world;
    this.x = x ?? rand(w.minX + this.size, Math.max(w.minX + this.size, w.maxX - this.size));
    this.y = w.topY;
    this.vx = this.vy = 0;
    this.support = null;
    this.go('air', { flail: true, greet: true });
  }

  /** "Rappeler le singe" : réapparaît près du curseur. */
  recall(x, y) {
    const w = this.world;
    this.x = clamp(x, w.minX + this.size * 0.4, w.maxX - this.size * 0.4);
    this.y = Math.min(y, w.floorY);
    this.vx = this.vy = 0;
    this.support = null;
    this.fx.emote('!');
    this.go('air', { flail: true });
  }

  onCursor(pos) {
    this.cursor = pos;
    if (!pos) {
      this.cursorNear = false;
      return;
    }
    const F = this.cfg.cursor;
    const near = Math.hypot(pos.x - this.x, pos.y - (this.y - this.size * 0.5)) < F.followRadius * this.k;
    if (near && !this.cursorNear && !this.paused && this.followCooldown <= 0) {
      if (['idle', 'walk', 'sit'].includes(this.state) && !this.d.ledgeId && !this.d.crossing) {
        this.followCooldown = F.followCooldown;
        if (chance(F.followChance)) this.go('follow');
      }
    }
    this.cursorNear = near;
  }

  onClick() {
    const s = this.state;
    if (this.mood === 'angry' && this.support && CALM.has(s)) {
      this.fx.emote('🍌!!'); // pas de coucou tant qu'il n'a pas eu sa banane
      return this.go('angry', {});
    }
    if (s === 'sleep' || s === 'yawn') {
      this.fx.emote('!');
      return this.go('jump', { height: this.size * 0.5, startled: true });
    }
    if (s === 'climb') return this.fx.emote('!');
    if (!this.support || !['idle', 'walk', 'sit', 'scratch', 'happy', 'follow', 'paused', 'dizzy'].includes(s)) return;
    if (chance(0.5)) {
      this.fx.emote(chance(0.5) ? '♥' : '♪');
      this.go('wave');
    } else {
      this.fx.emote('!');
      this.go('jump', { height: this.cfg.movement.hopHeight * this.size * 1.3 });
    }
  }

  onPet() {
    if (!this.support || !CALM.has(this.state) || this.state === 'happy') return;
    this.fx.emote('♥');
    this.go('happy');
  }

  startDrag(cursor) {
    if (this.state === 'transfer') return false;
    this.pendingShove = null;
    this.grab = { cursor: { ...cursor }, offX: this.x - cursor.x, offY: this.y - cursor.y, vx: 0 };
    this.go('dragged');
    return true;
  }

  dragTo(cursor, vx) {
    if (!this.grab) return;
    this.grab.cursor = { ...cursor };
    this.grab.vx = vx;
  }

  endDrag(vx, vy) {
    if (!this.grab) return;
    this.grab = null;
    const max = this.cfg.movement.maxThrowSpeed * this.k;
    this.vx = clamp(vx, -max, max);
    this.vy = clamp(vy, -max, max);
    this.support = null;
    this.go('air', { flail: true });
  }

  // ---------------------------------------------------------------------------
  //  Jeu : caca, bananes, humeur et bêtises
  // ---------------------------------------------------------------------------
  /** Réglages du menu "Jeu". */
  setGame(g) {
    this.game = { ...this.game, ...g };
    if (!this.game.bananas) {
      this.items.removeBananas();
      this.mood = 'ok';
    }
  }

  /** Le point p est-il assez près de lui pour lui donner la banane ? */
  isNear(p) {
    return Math.hypot(p.x - this.x, p.y - (this.y - this.size * 0.45)) < this.cfg.game.giveRadius * this.size;
  }

  /** On lui donne une banane. Retourne false s'il ne peut pas la prendre maintenant. */
  feed() {
    if (!this.support || ['air', 'jump', 'dragged', 'climb', 'transfer', 'eat'].includes(this.state)) return false;
    this.energy = Math.min(1, this.energy + 0.3);
    this.mood = 'ok';
    this.pendingShove = null;
    this.items.resetBananaAges(); // il est content pour un moment
    this.poopTimer = Math.min(this.poopTimer, range(this.cfg.game.poopAfterEating)); // ... et ça va passer
    this.go('eat');
    return true;
  }

  /** Une banane vient de toucher le sol. */
  onBananaLanded(it) {
    if (it.fromUser) {
      // Lâchée juste à côté de lui : il l'attrape.
      const near =
        Math.abs(it.x - this.x) < this.cfg.game.giveRadius * this.size && Math.abs(it.y - this.y) < this.size * 0.4;
      if (near && this.feed()) this.items.consume(it);
      return;
    }
    // Tombée du ciel : il la réclame.
    if (this.support && CALM.has(this.state) && !this.paused) this.go('beg');
  }

  onPoopCleaned() {
    if (this.support && CALM.has(this.state) && chance(0.5)) this.fx.emote('✨');
  }

  _updateGame(dt) {
    const G = this.cfg.game;
    // Les minuteries n'avancent que si vous êtes là et qu'il est réveillé.
    this.gameActive =
      !this.paused && !this.hidden && !this.userAway() && this.state !== 'sleep' && this.state !== 'yawn';
    if (this.gameActive) {
      if (this.game.poop) this.poopTimer -= dt;
      if (this.game.bananas) this.bananaTimer -= dt;
    }
    if (this.bananaTimer <= 0) {
      this.bananaTimer = range(G.bananaEvery);
      if (this.game.bananas && this.items.count('banana') < G.maxBananas) this.items.spawnBanana();
    }
    if (this.poopTimer <= 0 && this.state === 'idle' && this.support?.kind === 'floor') {
      this.poopTimer = range(G.poopEvery);
      if (this.game.poop && this.items.count('poop') < G.maxPoops) return this.go('poop');
    }
    this._updateMood(dt);
  }

  // L'humeur dépend de la plus vieille banane qu'on ne lui a pas donnée.
  _updateMood(dt) {
    const G = this.cfg.game;
    const waited = this.game.bananas ? this.items.oldestBananaAge() : 0;
    const mood = waited >= G.bananaPatience ? 'angry' : waited >= G.bananaPatience * 0.5 ? 'annoyed' : 'ok';
    if (mood !== this.mood) {
      this.mood = mood;
      if (mood === 'annoyed') this.begTimer = 0;
      if (mood === 'angry') {
        this.fx.emote('💢');
        this.mischiefTimer = rand(2, 5);
      }
    }
    if (!this.gameActive || !this.support) return;
    const calm = ['idle', 'sit', 'walk', 'follow', 'scratch'].includes(this.state);
    if (mood === 'annoyed') {
      this.begTimer -= dt;
      if (this.begTimer <= 0 && calm) {
        this.begTimer = rand(8, 15);
        this.go('beg');
      }
    } else if (mood === 'angry') {
      this.mischiefTimer -= dt;
      if (this.mischiefTimer <= 0 && calm) {
        this.mischiefTimer = range(G.mischiefEvery);
        this.mischief();
      }
    }
  }

  /** Il est fâché : il trépigne, puis bouscule une fenêtre ou écrit une note. */
  mischief() {
    const canNote = this.game.prankNotes && this.clock - this.lastNoteAt >= this.cfg.game.noteCooldown;
    // Déjà sur une fenêtre : il bouscule celle-ci. Sinon il va grimper sur une autre.
    const here = this.game.prankWindows && this.onLedge() ? this.support.id : null;
    const shove =
      this.game.prankWindows && this.climbEnabled && this.support?.kind === 'floor' ? this.pickClimb() : null;
    const canShove = !!(here || shove);
    let next = null;
    if (canShove && canNote) {
      next = this.lastMischief === 'window' ? 'note' : 'window'; // on alterne
    } else {
      next = canShove ? 'window' : canNote ? 'note' : null;
    }
    this.lastMischief = next;
    this.go('angry', { next, shove, here });
  }

  /** Calcule de combien pousser la fenêtre (en restant aux 3/4 à l'écran). */
  planWindowShove(id) {
    const l = this.world.ledges.get(id);
    if (!l) return null;
    const G = this.cfg.game;
    const w = this.world;
    const width = l.right - l.left;
    const minLeft = w.minX - width * 0.25;
    const maxLeft = Math.max(minLeft, w.maxX - width * 0.75);
    let dx = range(G.windowShove) * this.k * (chance(0.5) ? 1 : -1);
    if (l.left + dx < minLeft || l.left + dx > maxLeft) dx = -dx;
    dx = clamp(l.left + dx, minLeft, maxLeft) - l.left;
    let dy = rand(0, 80) * this.k;
    dy = Math.max(0, Math.min(dy, w.floorY - 150 - l.y));
    if (Math.abs(dx) < 20 && dy < 20) return null;
    return { dx: Math.round(dx), dy: Math.round(dy) };
  }
}
