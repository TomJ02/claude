// =============================================================================
//  monkey.js : le singe 3D "procédural", construit uniquement avec des
//  primitives Three.js (sphères, capsules, cônes...). Style low-poly / cartoon.
//
//  Le modèle mesure ~2 unités de haut, pieds à y = 0, et regarde vers +Z
//  (vers la caméra). La scène (stage.js) le met à l'échelle en pixels.
//
//  Pour modifier les ANIMATIONS, voir animations.js.
//  Pour modifier les COULEURS / le contour, voir config.js.
//
//  Interface commune avec gltfMonkey.js (modèle .glb) :
//    play(nom, {blend})   setFacing(dir)   setCycleRate(rad/s)   setSwing(rad)
//    setLookTarget(dx, dy) update(dt)       isSettled()           headPosition(v)
//    setProp(nom, valeur) object3d          hitTargets            dispose()
// =============================================================================
import * as THREE from 'three';
import { ANIMATIONS, REST_POSE, createPose, copyPose, lerpPose } from './animations.js';
import { ToonKit, group, ellipsoid, noRaycast } from './toon.js';
import { buildBanana } from './props.js';

const HIP_HEIGHT = 0.5; // hauteur des hanches debout
const SWING_PIVOT = 1.55; // point par lequel on "attrape" le singe (nuque)
const SKULL_Y = 0.42; // centre du crâne au-dessus du cou
const { PI, sqrt, min, max, exp, atan2 } = Math;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (x) => x * x * (3 - 2 * x);

export class ProceduralMonkey {
  constructor(config) {
    this.cfg = config;
    this.height = 2; // en unités du modèle
    this.object3d = new THREE.Group();
    this.object3d.name = 'monkey';
    this.hitTargets = [];
    this.kit = new ToonKit(config);
    this._build();

    // État de l'animation
    this.pose = createPose(); // pose courante (sans le regard ni les clignements)
    this._from = createPose(); // pose de départ du fondu
    this._target = createPose(); // pose calculée par l'animation courante
    this.anim = 'idle';
    this.animTime = 0;
    this.blendTime = 0;
    this.blendDur = 0;
    this.phase = 0;
    this.cycleRate = 0;
    this.swingAngle = 0;

    this.yaw = 0;
    this.targetYaw = 0;
    this.faceBack = false;
    this.look = { active: false, tYaw: 0, tPitch: 0, yaw: 0, pitch: 0 };
    this.blink = { next: 1.5 + Math.random() * 3, t: -1 };

    this.update(0);
  }

  // ---------------------------------------------------------------------------
  //  API
  // ---------------------------------------------------------------------------

  /** Lance une animation (voir animations.js) avec un fondu de `blend` secondes. */
  play(name, { blend = 0.22, restart = false } = {}) {
    if (!ANIMATIONS[name]) name = 'idle';
    if (name === this.anim && !restart) return;
    copyPose(this._from, this.pose);
    this.anim = name;
    this.animTime = 0;
    this.blendTime = 0;
    this.blendDur = blend;
  }

  /** Vitesse du cycle de marche/escalade en radians par seconde. */
  setCycleRate(rate) {
    this.cycleRate = rate;
  }

  /** Balancement (rad) quand on le porte. */
  setSwing(angle) {
    this.swingAngle = angle;
  }

  /**
   * Orientation : -1 = vers la gauche de l'écran, 1 = vers la droite, 0 = de face,
   * valeurs intermédiaires acceptées ; 'back' = de dos (escalade).
   */
  setFacing(dir) {
    this.faceBack = dir === 'back';
    if (!this.faceBack) this.targetYaw = clamp(dir, -1, 1) * this.cfg.render.sideYaw;
  }

  /** Regarde vers un point situé à (dx, dy) pixels de sa tête, ou null. */
  setLookTarget(dx, dy) {
    if (dx == null) {
      this.look.active = false;
      return;
    }
    this.look.active = true;
    this.look.tYaw = clamp(atan2(dx, 380), -1.1, 1.1);
    this.look.tPitch = clamp(atan2(dy, 480), -0.45, 0.5);
  }

  /** true quand plus rien ne bouge à part la respiration (fondu terminé, tête immobile). */
  isSettled() {
    const yawGoal = this.faceBack ? (this.yaw < 0 ? -PI : PI) : this.targetYaw;
    return (
      this.blendDur === 0 &&
      Math.abs(yawGoal - this.yaw) < 0.005 &&
      Math.abs(this.look.yaw - (this.look.active ? this.look.tYaw : 0)) < 0.01
    );
  }

  /**
   * Accessoire : 'banana' = banane dans la main (valeur 0..1 = ce qu'il en
   * reste, 0 = rien en main).
   */
  setProp(name, value) {
    if (name !== 'banana') return;
    const k = this.bananaScale;
    this.banana.visible = value > 0.02;
    this.banana.scale.set(k * Math.max(0.05, value), k, k); // mangée par le bout
  }

  /** Position monde du centre de la tête (pour placer les bulles "Zzz", "!"...). */
  headPosition(target) {
    this.head.updateWorldMatrix(true, false);
    return this.head.localToWorld(target.set(0, SKULL_Y, 0));
  }

  update(dt) {
    this.animTime += dt;
    this.phase += this.cycleRate * dt;

    // 1) Pose de l'animation courante + fondu depuis la précédente
    const anim = ANIMATIONS[this.anim];
    copyPose(this._target, REST_POSE);
    anim.pose(this._target, { t: this.animTime, phase: this.phase, swing: this.swingAngle });
    let w = 1;
    if (this.blendDur > 0) {
      this.blendTime += dt;
      w = smooth(min(1, this.blendTime / this.blendDur));
      if (w >= 1) this.blendDur = 0;
    }
    lerpPose(this.pose, this._from, this._target, w);

    // 2) Orientation (rotation progressive)
    const yawGoal = this.faceBack ? (this.yaw < 0 ? -PI : PI) : this.targetYaw;
    const step = this.cfg.render.turnSpeed * dt;
    this.yaw += clamp(yawGoal - this.yaw, -step, step);
    this.object3d.rotation.y = this.yaw;

    // 3) Regard vers le curseur (lissé)
    const lw = anim.lookWeight ?? 0;
    const k = 1 - exp(-dt * 7);
    const ty = this.look.active ? clamp(this.look.tYaw - this.yaw, -1, 1) * lw : 0;
    const tp = this.look.active ? this.look.tPitch * lw : 0;
    this.look.yaw += (ty - this.look.yaw) * k;
    this.look.pitch += (tp - this.look.pitch) * k;

    // 4) Clignement des yeux aléatoire
    let blink = 1;
    this.blink.next -= dt;
    if (this.blink.next <= 0 && this.blink.t < 0) this.blink.t = 0;
    if (this.blink.t >= 0) {
      this.blink.t += dt;
      const d = 0.16;
      blink = this.blink.t < d ? Math.abs(this.blink.t / d - 0.5) * 2 : 1;
      if (this.blink.t >= d) {
        this.blink.t = -1;
        this.blink.next = 2 + Math.random() * 4;
      }
    }

    this._apply(this.pose, blink);
  }

  dispose() {
    this.kit.dispose();
  }

  // ---------------------------------------------------------------------------
  //  Application de la pose sur le squelette
  // ---------------------------------------------------------------------------
  _apply(p, blink) {
    const sq = p.squash;
    const inv = 1 / sqrt(sq);
    this.squashGroup.scale.set(inv, sq, inv);
    this.swingPivot.rotation.z = p.swing;

    this.hips.position.set(p.hipsX, HIP_HEIGHT + p.hipsY, 0);
    this.hips.rotation.set(p.bodyLean, p.bodyTurn, -p.bodyRoll);
    this.chest.rotation.set(p.chestLean, p.chestTurn, -p.chestRoll);
    this.head.rotation.set(p.headNod + this.look.pitch, p.headTurn + this.look.yaw, -p.headTilt);

    const { armL, armR, legL, legR } = this;
    armL.shoulder.rotation.set(-p.armLFwd, p.armLTwist, p.armLRaise);
    armL.elbow.rotation.set(-p.foreLBend, 0, p.foreLSide);
    armR.shoulder.rotation.set(-p.armRFwd, -p.armRTwist, -p.armRRaise);
    armR.elbow.rotation.set(-p.foreRBend, 0, -p.foreRSide);

    legL.thigh.rotation.set(-p.legLFwd, 0, p.legLOut);
    legL.knee.rotation.x = p.kneeL;
    legL.ankle.rotation.x = (p.legLFwd - p.kneeL) * 0.5;
    legR.thigh.rotation.set(-p.legRFwd, 0, -p.legROut);
    legR.knee.rotation.x = p.kneeR;
    legR.ankle.rotation.x = (p.legRFwd - p.kneeR) * 0.5;

    // Queue : chaque segment s'enroule un peu plus que le précédent
    this.tailRoot.rotation.x = -1.95 + p.tailLift;
    const n = this.tailSegs.length;
    for (let i = 0; i < n; i++) {
      const seg = this.tailSegs[i];
      seg.rotation.x = i === 0 ? 0 : p.tailCurl;
      seg.rotation.z = p.tailSwing * (0.4 + i / n) * 0.35;
    }

    // Visage : yeux, bouche, joues
    const open = clamp(p.eyesOpen * blink, 0, 1);
    for (const eye of this.eyes) {
      const showOpen = p.eyesMode === 0;
      eye.open.visible = showOpen;
      eye.open.scale.y = max(0.1, open);
      eye.highlight.visible = showOpen && open > 0.6;
      eye.closed.visible = !showOpen;
      eye.closed.rotation.z = p.eyesMode === 2 ? 0 : PI; // ^ heureux / ‿ endormi
    }
    const mo = p.mouthOpen;
    this.smile.visible = mo < 0.15;
    this.mouth.visible = mo >= 0.15;
    this.mouth.scale.set(0.8 + mo * 0.3, mo, 1);
    const blush = max(0.001, p.blush);
    for (const b of this.blush) b.scale.setScalar(blush);
    for (const b of this.brows) {
      b.visible = p.brows > 0.05;
      b.scale.setScalar(max(0.05, p.brows));
    }
  }

  // ---------------------------------------------------------------------------
  //  Construction du modèle
  // ---------------------------------------------------------------------------
  _build() {
    const C = this.cfg.colors;
    const root = this.object3d;

    this.swingPivot = group(root, 0, SWING_PIVOT, 0);
    const offset = group(this.swingPivot, 0, -SWING_PIVOT, 0);
    this.squashGroup = group(offset); // l'écrasement se fait depuis les pieds

    const hips = (this.hips = group(this.squashGroup, 0, HIP_HEIGHT, 0));
    hips.rotation.order = 'YXZ';

    // Corps et ventre
    this._part(ellipsoid(0.33, 0.37, 0.29, 14, 10), C.fur, hips, { pos: [0, 0.2, 0] });
    this._part(ellipsoid(0.23, 0.27, 0.13, 12, 8), C.skin, hips, { pos: [0, 0.16, 0.19], outline: false });

    this.legL = this._leg(hips, 1);
    this.legR = this._leg(hips, -1);
    this._tail(hips);

    const chest = (this.chest = group(hips, 0, 0.4, 0));
    this.armL = this._arm(chest, 1);
    this.armR = this._arm(chest, -1);

    const head = (this.head = group(chest, 0, 0.1, 0));
    head.rotation.order = 'YXZ';
    this._head(head);
  }

  _leg(parent, side) {
    const C = this.cfg.colors;
    const thigh = group(parent, side * 0.15, -0.02, 0);
    this._part(limb(0.088, 0.2), C.fur, thigh);
    const knee = group(thigh, 0, -0.2, 0);
    this._part(limb(0.078, 0.18), C.fur, knee);
    const ankle = group(knee, 0, -0.18, 0);
    this._part(ellipsoid(0.095, 0.06, 0.145, 10, 6), C.skin, ankle, { pos: [0, -0.035, 0.05] });
    return { thigh, knee, ankle };
  }

  _arm(parent, side) {
    const C = this.cfg.colors;
    const shoulder = group(parent, side * 0.29, 0.07, 0);
    this._part(limb(0.072, 0.22), C.fur, shoulder);
    const elbow = group(shoulder, 0, -0.22, 0);
    this._part(limb(0.064, 0.2), C.fur, elbow);
    this._part(ellipsoid(0.09, 0.095, 0.085, 10, 6), C.skin, elbow, { pos: [0, -0.25, 0] });
    if (side === 1) {
      // Banane tenue dans la main gauche (visible seulement quand il mange)
      this.banana = buildBanana(this.kit);
      this.banana.position.set(0.02, -0.22, 0.12);
      this.banana.rotation.set(0.3, 0, -Math.PI / 2 - 0.75);
      this.bananaScale = 1.3;
      this.banana.visible = false;
      this.banana.traverse((o) => (o.raycast = noRaycast));
      elbow.add(this.banana);
    }
    return { shoulder, elbow };
  }

  _tail(hips) {
    const C = this.cfg.colors;
    const root = (this.tailRoot = group(hips, 0.03, 0.02, -0.24));
    root.rotation.order = 'YXZ';
    root.rotation.y = -0.75; // la queue part un peu sur le côté pour être visible de face
    this.tailSegs = [];
    let parent = root;
    const n = 9;
    const len = 0.085;
    for (let i = 0; i < n; i++) {
      const seg = group(parent, 0, i === 0 ? 0 : len, 0);
      const r = 0.048 - i * 0.002;
      const g = new THREE.CapsuleGeometry(r, len, 2, 6);
      g.translate(0, len / 2, 0);
      this._part(g, C.fur, seg);
      this.tailSegs.push(seg);
      parent = seg;
    }
  }

  _head(h) {
    const C = this.cfg.colors;
    const c = SKULL_Y;

    // Crâne
    this._part(ellipsoid(0.46, 0.44, 0.43, 16, 12), C.fur, h, { pos: [0, c, 0] });

    // Touffe de poils
    const tuft = [
      [0, 0.06, 0],
      [0.07, 0.04, -0.5],
      [-0.07, 0.04, 0.5],
    ];
    for (const [x, z, rz] of tuft) {
      this._part(new THREE.ConeGeometry(0.055, 0.17, 5), C.furDark, h, {
        pos: [x, c + 0.47, z],
        rot: [0.15, 0, rz],
      });
    }

    // Oreilles
    for (const side of [1, -1]) {
      const ear = group(h, side * 0.45, c + 0.03, -0.03);
      ear.rotation.y = side * 0.45;
      const outer = new THREE.CylinderGeometry(0.165, 0.165, 0.08, 12);
      outer.rotateX(PI / 2);
      this._part(outer, C.fur, ear);
      const inner = new THREE.CylinderGeometry(0.105, 0.105, 0.03, 12);
      inner.rotateX(PI / 2);
      this._part(inner, C.earInner, ear, { pos: [0, 0, 0.035], outline: false });
    }

    // Masque du visage : deux ronds autour des yeux + museau
    for (const side of [1, -1]) {
      this._part(ellipsoid(0.2, 0.2, 0.2, 12, 9), C.skin, h, { pos: [side * 0.15, c + 0.08, 0.24], outline: false });
    }
    this._part(ellipsoid(0.27, 0.19, 0.21, 14, 9), C.skin, h, { pos: [0, c - 0.12, 0.27], outline: false });

    // Yeux (ouverts / fermés) avec petit reflet blanc
    this.eyes = [];
    const highlightMat = this.kit.basic('highlight', 0xffffff);
    for (const side of [1, -1]) {
      const eye = group(h, side * 0.15, c + 0.09, 0.425);
      const open = this._part(ellipsoid(0.068, 0.085, 0.03, 10, 8), C.eyes, eye, { outline: false, flat: false });
      const hl = new THREE.Mesh(this.kit.geo(ellipsoid(0.024, 0.024, 0.015, 6, 4)), highlightMat);
      hl.position.set(0.022, 0.032, 0.024);
      hl.raycast = noRaycast;
      eye.add(hl);
      const arc = new THREE.TorusGeometry(0.058, 0.014, 4, 10, PI);
      const closed = this._part(arc, C.eyes, eye, { pos: [0, 0.01, 0.018], outline: false });
      closed.visible = false;
      this.eyes.push({ open, highlight: hl, closed });
    }

    // Sourcils froncés (visibles seulement quand il est fâché)
    this.brows = [];
    for (const side of [1, -1]) {
      const brow = new THREE.CapsuleGeometry(0.018, 0.09, 2, 6);
      brow.rotateZ(PI / 2);
      const b = this._part(brow, C.furDark, h, {
        pos: [side * 0.15, c + 0.21, 0.405],
        rot: [0, 0, side * 0.42],
        outline: false,
      });
      b.visible = false;
      this.brows.push(b);
    }

    // Narines
    for (const side of [1, -1]) {
      this._part(ellipsoid(0.019, 0.014, 0.01, 6, 4), C.mouth, h, {
        pos: [side * 0.042, c - 0.06, 0.472],
        outline: false,
      });
    }

    // Bouche : sourire (arc) ou bouche ouverte (ovale sombre + langue)
    const smileGeo = new THREE.TorusGeometry(0.065, 0.014, 4, 12, PI);
    smileGeo.rotateZ(PI);
    this.smile = this._part(smileGeo, C.mouth, h, { pos: [0, c - 0.105, 0.468], outline: false });
    this.mouth = group(h, 0, c - 0.17, 0.462);
    this._part(ellipsoid(0.07, 0.06, 0.03, 10, 6), C.mouth, this.mouth, { outline: false });
    this._part(ellipsoid(0.045, 0.025, 0.02, 8, 4), C.blush, this.mouth, { pos: [0, -0.028, 0.014], outline: false });

    // Joues roses
    this.blush = [];
    for (const side of [1, -1]) {
      const b = group(h, side * 0.29, c - 0.09, 0.345);
      b.rotation.y = side * 0.7;
      this._part(ellipsoid(0.07, 0.042, 0.02, 8, 5), C.blush, b, { outline: false });
      this.blush.push(b);
    }
  }

  // Crée une pièce cartoon (voir toon.js) que la souris peut toucher.
  _part(geometry, color, parent, opts) {
    const mesh = this.kit.part(geometry, color, parent, opts);
    this.hitTargets.push(mesh);
    return mesh;
  }
}

// -----------------------------------------------------------------------------
//  Utilitaires
// -----------------------------------------------------------------------------
// Capsule qui part de son articulation (y = 0) et descend de `len`.
function limb(r, len) {
  const g = new THREE.CapsuleGeometry(r, len, 3, 8);
  g.translate(0, -len / 2, 0);
  return g;
}
