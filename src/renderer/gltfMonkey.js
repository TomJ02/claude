// =============================================================================
//  gltfMonkey.js : utilise un modèle .glb (Blender, Mixamo, Sketchfab...) à la
//  place du singe procédural. Même interface que monkey.js.
//
//  Le fichier est cherché (par le processus principal) à ces emplacements :
//    1. <dossier de données de l'appli>/monkey.glb   (menu > "Dossier du modèle 3D…")
//    2. assets/models/monkey.glb                      (dans le projet)
//
//  Le modèle est automatiquement mis à l'échelle (pieds au sol) et doit
//  regarder vers l'avant (+Z, sinon réglez CONFIG.glb.rotationY). Les
//  animations sont associées par leur NOM (voir CONFIG.glb.clips) ; celles qui
//  manquent sont remplacées par une animation proche (voir FALLBACK).
// =============================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SWING_PIVOT = 1.55;
const { PI, atan2 } = Math;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Si une animation manque, on essaie celle-ci à la place.
const FALLBACK = {
  sitLedge: 'sit',
  scratchSit: 'scratch',
  sleep: 'sit',
  yawn: 'idle',
  scratch: 'idle',
  wave: 'idle',
  happy: 'wave',
  crouch: 'idle',
  air: 'fall',
  fall: 'air',
  land: 'idle',
  dragged: 'fall',
  climb: 'walk',
  dizzy: 'sit',
  poop: 'crouch',
  eat: 'sit',
  angry: 'dizzy',
  beg: 'wave',
  type: 'sit',
  sit: 'idle',
  walk: 'idle',
};
// Animations jouées une seule fois (les autres bouclent).
const ONCE = new Set(['crouch', 'land', 'yawn']);
// Vitesse de cycle de référence (rad/s) correspondant à une lecture à vitesse 1.
const NOMINAL_CYCLE = 9;

export class GltfMonkey {
  static async load(url, config) {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new GltfMonkey(gltf, config);
  }

  constructor(gltf, config) {
    this.cfg = config;
    this.height = 2;
    this.object3d = new THREE.Group();
    this.swingPivot = new THREE.Group();
    this.swingPivot.position.y = SWING_PIVOT;
    this.object3d.add(this.swingPivot);
    const inner = new THREE.Group();
    inner.position.y = -SWING_PIVOT;
    this.swingPivot.add(inner);

    // Mise à l'échelle : 2 unités de haut, pieds à y = 0, centré.
    const model = gltf.scene;
    model.rotation.y = config.glb.rotationY;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = this.height / Math.max(size.y, 1e-6);
    model.scale.multiplyScalar(scale);
    model.updateMatrixWorld(true);
    box.setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
    inner.add(model);

    this.hitTargets = [];
    this.headBone = null;
    model.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.frustumCulled = false;
        this.hitTargets.push(o);
      }
      if (!this.headBone && /head/i.test(o.name) && (o.isBone || o.type === 'Object3D')) this.headBone = o;
    });

    this.mixer = new THREE.AnimationMixer(model);
    this.clips = matchClips(gltf.animations, config.glb.clips);
    this.action = null;
    this.anim = null;
    this.fadeLeft = 0;
    this.cycleRate = 0;

    this.yaw = 0;
    this.targetYaw = 0;
    this.faceBack = false;
    this.look = { active: false, tYaw: 0, tPitch: 0, yaw: 0, pitch: 0 };
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');

    this.play('idle', { blend: 0 });
  }

  play(name, { blend = 0.22, restart = false } = {}) {
    const resolved = this._resolve(name);
    if (!resolved) return;
    if (resolved === this.anim && !restart) return;
    const next = this.mixer.clipAction(this.clips[resolved]);
    next.reset();
    next.setLoop(ONCE.has(resolved) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = true;
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.play();
    if (this.action && this.action !== next) {
      if (blend > 0) this.action.crossFadeTo(next, blend, false);
      else this.action.stop();
    }
    this.action = next;
    this.anim = resolved;
    this.fadeLeft = blend;
  }

  _resolve(name) {
    const seen = new Set();
    let n = name;
    while (n && !seen.has(n)) {
      if (this.clips[n]) return n;
      seen.add(n);
      n = FALLBACK[n] ?? 'idle';
    }
    return Object.keys(this.clips)[0] ?? null;
  }

  setCycleRate(rate) {
    this.cycleRate = rate;
  }

  // Pas d'accessoire (banane en main) sur un modèle personnalisé.
  setProp() {}

  setSwing(angle) {
    this.swingPivot.rotation.z = angle;
  }

  setFacing(dir) {
    this.faceBack = dir === 'back';
    if (!this.faceBack) this.targetYaw = clamp(dir, -1, 1) * this.cfg.render.sideYaw;
  }

  setLookTarget(dx, dy) {
    if (dx == null) {
      this.look.active = false;
      return;
    }
    this.look.active = true;
    this.look.tYaw = clamp(atan2(dx, 380), -1, 1);
    this.look.tPitch = clamp(atan2(dy, 480), -0.4, 0.4);
  }

  isSettled() {
    const yawGoal = this.faceBack ? (this.yaw < 0 ? -PI : PI) : this.targetYaw;
    return this.fadeLeft <= 0 && Math.abs(yawGoal - this.yaw) < 0.005;
  }

  headPosition(target) {
    if (this.headBone) {
      this.headBone.updateWorldMatrix(true, false);
      return this.headBone.getWorldPosition(target);
    }
    this.object3d.updateWorldMatrix(true, false);
    return this.object3d.localToWorld(target.set(0, 1.45, 0));
  }

  update(dt) {
    // Les cycles de marche / escalade suivent la vitesse réelle du singe.
    if (this.action && (this.anim === 'walk' || this.anim === 'climb')) {
      this.action.setEffectiveTimeScale(this.cycleRate > 0 ? this.cycleRate / NOMINAL_CYCLE : 1);
    }
    // Annule la rotation de regard de l'image précédente avant d'animer.
    if (this._headBase) this.headBone.quaternion.copy(this._headBase);
    this.mixer.update(dt);
    this.fadeLeft = Math.max(0, this.fadeLeft - dt);

    const yawGoal = this.faceBack ? (this.yaw < 0 ? -PI : PI) : this.targetYaw;
    const step = this.cfg.render.turnSpeed * dt;
    this.yaw += clamp(yawGoal - this.yaw, -step, step);
    this.object3d.rotation.y = this.yaw;

    // Regard (si le modèle a un os "head" et que l'option est activée)
    if (this.headBone && this.cfg.glb.headLook !== false) {
      const k = 1 - Math.exp(-dt * 7);
      const ty = this.look.active ? clamp(this.look.tYaw - this.yaw, -0.8, 0.8) : 0;
      const tp = this.look.active ? this.look.tPitch : 0;
      this.look.yaw += (ty - this.look.yaw) * k;
      this.look.pitch += (tp - this.look.pitch) * k;
      this._e.set(this.look.pitch, this.look.yaw, 0);
      this._headBase = (this._headBase ?? new THREE.Quaternion()).copy(this.headBone.quaternion);
      this.headBone.quaternion.multiply(this._q.setFromEuler(this._e));
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.object3d.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose();
      for (const m of [].concat(o.material ?? [])) {
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
        m.dispose();
      }
    });
  }
}

// Associe nos noms d'animations (idle, walk...) aux clips du fichier.
function matchClips(animations, wanted) {
  const out = {};
  const lower = animations.map((c) => [c.name.toLowerCase(), c]);
  for (const [name, candidates] of Object.entries(wanted)) {
    let found = null;
    for (const cand of candidates) {
      const c = cand.toLowerCase();
      found = lower.find(([n]) => n === c)?.[1] ?? lower.find(([n]) => n.includes(c))?.[1];
      if (found) break;
    }
    if (found) out[name] = found;
  }
  if (!out.idle && animations[0]) out.idle = animations[0];
  return out;
}
