// =============================================================================
//  stage.js : rendu Three.js du singe.
//
//  Astuce de performance : la fenêtre couvre tout l'écran, mais le canvas
//  WebGL ne fait que la taille du singe (≈ 2 × sa hauteur). On le déplace avec
//  une transformation CSS (gérée par le compositeur, très peu coûteuse) au lieu
//  de redessiner un canvas plein écran à chaque image.
// =============================================================================
import * as THREE from 'three';

const CANVAS_RATIO = 1.9; // taille du canvas / taille du singe
const FOV = 22; // champ de vision vertical (degrés) : faible = peu de perspective
const MODEL_HEIGHT = 2; // hauteur du modèle en unités

export class Stage {
  constructor(container, config) {
    this.cfg = config;
    this.el = document.createElement('div');
    this.el.className = 'pet';
    container.appendChild(this.el);

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: config.render.antialias,
      premultipliedAlpha: true,
      powerPreference: 'low-power',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.el.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xfff6ea, 0x8a6a55, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-1.5, 2.5, 4);
    this.scene.add(key);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    this.raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._v = new THREE.Vector3();

    this.monkey = null;
    this.size = 0;
    this.canvasSize = 0;
    this.left = 0;
    this.top = 0;
    this.anchorX = 0;
    this.anchorY = 0;
    this.visible = true;
  }

  setMonkey(monkey) {
    if (this.monkey) {
      this.scene.remove(this.monkey.object3d);
      this.monkey.dispose();
    }
    this.monkey = monkey;
    this.scene.add(monkey.object3d);
  }

  /** Taille du singe en pixels CSS. Recalcule le canvas et la caméra. */
  setSize(px) {
    this.size = px;
    const S = (this.canvasSize = Math.round(px * CANVAS_RATIO));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.cfg.render.maxPixelRatio));
    this.renderer.setSize(S, S, true);

    // Cadrage : MODEL_HEIGHT unités = px pixels ; pieds à ~70 % de la hauteur.
    const viewH = (S * MODEL_HEIGHT) / px;
    const dist = viewH / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    const lookY = viewH * 0.2;
    this.camera.aspect = 1;
    this.camera.position.set(0, lookY + dist * 0.1, dist); // légère vue plongeante
    this.camera.lookAt(0, lookY, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    // Où tombent les pieds (origine du modèle) dans le canvas ?
    this._v.set(0, 0, 0).project(this.camera);
    this.anchorX = ((this._v.x + 1) / 2) * S;
    this.anchorY = ((1 - this._v.y) / 2) * S;
    this.left = this.top = NaN; // force le repositionnement
  }

  /** Recalcule la résolution si l'écran (DPI) a changé. */
  refreshPixelRatio() {
    const pr = Math.min(window.devicePixelRatio || 1, this.cfg.render.maxPixelRatio);
    if (pr !== this.renderer.getPixelRatio()) this.setSize(this.size);
  }

  /** Place le singe pour que ses pieds soient au point écran (x, y). */
  place(x, y) {
    const pr = this.renderer.getPixelRatio();
    const left = Math.round((x - this.anchorX) * pr) / pr;
    const top = Math.round((y - this.anchorY) * pr) / pr;
    if (left !== this.left || top !== this.top) {
      this.left = left;
      this.top = top;
      this.el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    }
  }

  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.el.style.visibility = v ? 'visible' : 'hidden';
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Le point écran (x, y) touche-t-il le singe ? (lancer de rayon précis) */
  hitTest(x, y) {
    if (!this.monkey || !this.visible) return false;
    const lx = x - this.left;
    const ly = y - this.top;
    const S = this.canvasSize;
    if (!(lx >= 0 && ly >= 0 && lx < S && ly < S)) return false;
    this._ndc.set((lx / S) * 2 - 1, -(ly / S) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    return this.raycaster.intersectObjects(this.monkey.hitTargets, false).length > 0;
  }

  /** Convertit un point 3D (repère monde) en coordonnées écran. */
  toScreen(v3, out = {}) {
    this._v.copy(v3).project(this.camera);
    out.x = this.left + ((this._v.x + 1) / 2) * this.canvasSize;
    out.y = this.top + ((1 - this._v.y) / 2) * this.canvasSize;
    return out;
  }

  /** Position écran du centre de la tête. */
  headScreen(out = {}) {
    if (!this.monkey) return out;
    return this.toScreen(this.monkey.headPosition(this._v), out);
  }
}
