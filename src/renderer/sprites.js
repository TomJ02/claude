// =============================================================================
//  sprites.js : dessine une fois pour toutes les objets 3D (banane, caca) dans
//  des images PNG. Les objets posés à l'écran sont ensuite de simples <img>
//  déplacées en CSS : aucun coût de rendu 3D tant qu'ils ne bougent pas.
// =============================================================================
import * as THREE from 'three';
import { ToonKit } from './toon.js';
import { buildBanana, buildPoop } from './props.js';

const RES = 192; // résolution des images (px), suffisante jusqu'à la taille "très grand"

/**
 * Retourne { banana, poop } ; chaque entrée : { url, bottom } où `bottom` est
 * la position (0..1, depuis le haut) du point le plus bas de l'objet dans l'image.
 */
export function renderSprites(config) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(RES, RES, false);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff6ea, 0x8a6a55, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(-1.5, 2.5, 4);
  scene.add(key);

  const kit = new ToonKit(config);
  const out = {};
  const items = {
    // Banane couchée, vue un peu de dessus
    banana: () => {
      const b = buildBanana(kit);
      b.position.x = -0.25;
      const g = new THREE.Group();
      g.add(b);
      g.rotation.set(0.45, 0, -0.08);
      return g;
    },
    // Caca vu légèrement de dessus
    poop: () => {
      const p = buildPoop(kit);
      p.rotation.x = 0.3;
      return p;
    },
  };

  for (const [name, build] of Object.entries(items)) {
    const obj = build();
    scene.add(obj);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const half = (Math.max(s.x, s.y) / 2) * 1.12; // marge pour le contour
    const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 10);
    cam.position.set(c.x, c.y, 5);
    cam.lookAt(c.x, c.y, 0);
    renderer.render(scene, cam);
    out[name] = { url: renderer.domElement.toDataURL('image/png'), bottom: 0.5 + s.y / 2 / (2 * half) };
    scene.remove(obj);
  }

  kit.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
