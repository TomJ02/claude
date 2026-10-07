// =============================================================================
//  props.js : petits objets 3D dans le même style que le singe.
//   - buildBanana : banane courbée à 5 pans (tige à l'origine, pointe vers +X)
//   - buildPoop   : petit tas de caca en spirale (posé sur y = 0)
//  Utilisés pour la banane qu'il tient en mangeant, et pour dessiner les images
//  des objets qui tombent / traînent à l'écran (voir sprites.js).
// =============================================================================
import * as THREE from 'three';
import { ellipsoid } from './toon.js';

export const PROP_COLORS = {
  banana: 0xffd84a,
  bananaTips: 0x6b4a1f,
  poop: 0x7a4520,
  poopDark: 0x5c3214,
};

/** Banane d'environ 0,5 unité de long : tige en (0, 0, 0), courbée vers le haut. */
export function buildBanana(kit) {
  const root = new THREE.Group();
  root.name = 'banana';
  const length = 0.5;
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(length * 0.5, -0.16, 0),
    new THREE.Vector3(length, 0.02, 0),
  );
  const tubular = 14;
  const radial = 5; // une banane a cinq pans
  const g = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  // Rayon variable : fine aux deux bouts, dodue au milieu
  const pos = g.attributes.position;
  const center = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular;
    curve.getPointAt(u, center);
    const r = Math.max(0.014, 0.072 * Math.pow(Math.sin(Math.PI * u), 0.55));
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(center).multiplyScalar(r).add(center);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  kit.part(g, PROP_COLORS.banana, root);

  // Tige et bout sombres
  const stem = new THREE.CylinderGeometry(0.016, 0.02, 0.07, 5);
  stem.rotateZ(Math.PI / 2 + 0.5);
  kit.part(stem, PROP_COLORS.bananaTips, root, { pos: [-0.02, 0.018, 0] });
  kit.part(ellipsoid(0.02, 0.02, 0.02, 6, 4), PROP_COLORS.bananaTips, root, { pos: [length, 0.02, 0] });
  return root;
}

/** Petit caca en spirale, ~0,6 unité de large et de haut, posé sur y = 0. */
export function buildPoop(kit) {
  const root = new THREE.Group();
  root.name = 'poop';
  const C = PROP_COLORS;
  kit.part(ellipsoid(0.3, 0.12, 0.27, 14, 8), C.poop, root, { pos: [0, 0.1, 0] });
  kit.part(ellipsoid(0.22, 0.1, 0.2, 12, 8), C.poop, root, { pos: [0.02, 0.24, 0] });
  kit.part(ellipsoid(0.14, 0.085, 0.13, 10, 6), C.poop, root, { pos: [-0.01, 0.36, 0] });
  const tip = new THREE.ConeGeometry(0.075, 0.16, 7);
  kit.part(tip, C.poop, root, { pos: [0.03, 0.47, 0], rot: [0, 0, -0.45] });
  // Petits creux plus sombres entre les étages (sans contour)
  for (const [y, rx] of [
    [0.175, 0.24],
    [0.305, 0.16],
  ]) {
    kit.part(ellipsoid(rx, 0.02, rx * 0.92, 12, 4), C.poopDark, root, { pos: [0, y, 0.01], outline: false });
  }
  return root;
}
