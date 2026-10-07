// =============================================================================
//  toon.js : outils partagés pour le style "cartoon low-poly" (le singe, la
//  banane, le caca...) : matériaux à paliers, contour sombre, facettes.
// =============================================================================
import * as THREE from 'three';

export function noRaycast() {}

export function group(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent?.add(g);
  return g;
}

export function ellipsoid(rx, ry, rz, w = 12, h = 9) {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  return g;
}

// Copie de la géométrie avec une normale par triangle (rendu à facettes).
export function toFlat(g) {
  const flat = g.index ? g.toNonIndexed() : g.clone();
  flat.computeVertexNormals();
  return flat;
}

// Dégradé en paliers pour l'éclairage "cartoon".
export function makeGradientMap(levels) {
  const data = new Uint8Array(levels.length * 4);
  levels.forEach((v, i) => {
    data.set([v * 255, v * 255, v * 255, 255], i * 4);
  });
  const tex = new THREE.DataTexture(data, levels.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// Contour "cartoon" : on redessine chaque pièce, gonflée le long de ses
// normales, en n'affichant que ses faces arrière, dans une couleur sombre.
export function makeOutlineMaterial(config) {
  const m = new THREE.MeshBasicMaterial({ color: config.colors.outline, side: THREE.BackSide });
  const width = config.render.outlineWidth;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uOutline = { value: width };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uOutline;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uOutline;');
  };
  m.customProgramCacheKey = () => `toon-outline-${width}`;
  return m;
}

/**
 * Fabrique de pièces cartoon : partage les matériaux par couleur et garde la
 * trace des géométries pour pouvoir tout libérer avec dispose().
 */
export class ToonKit {
  constructor(config) {
    this.cfg = config;
    this.gradient = makeGradientMap([0.42, 0.72, 1.0]);
    this.outline = config.render.outline ? makeOutlineMaterial(config) : null;
    this.materials = new Map();
    this.geometries = new Set();
  }

  /** Crée un mesh de couleur `color` (avec contour) et l'ajoute à `parent`. */
  part(geometry, color, parent, { pos, rot, outline = true, flat } = {}) {
    // Style "low-poly" : normales par facette (la géométrie lisse d'origine
    // reste utilisée pour le contour, qui doit être continu).
    const faceted = flat ?? this.cfg.render.flatShading;
    const visible = faceted ? toFlat(geometry) : geometry;
    const mesh = new THREE.Mesh(this.geo(visible), this.toon(color));
    if (pos) mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    parent?.add(mesh);
    if (outline && this.outline) {
      const o = new THREE.Mesh(this.geo(geometry), this.outline);
      o.raycast = noRaycast;
      mesh.add(o);
    }
    return mesh;
  }

  geo(g) {
    this.geometries.add(g);
    return g;
  }

  toon(color) {
    let m = this.materials.get(color);
    if (!m) {
      m = new THREE.MeshToonMaterial({ color, gradientMap: this.gradient });
      this.materials.set(color, m);
    }
    return m;
  }

  basic(key, color) {
    let m = this.materials.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color });
      this.materials.set(key, m);
    }
    return m;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    this.outline?.dispose();
    this.gradient.dispose();
  }
}
