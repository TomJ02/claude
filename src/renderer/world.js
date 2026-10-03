// =============================================================================
//  world.js : la "géométrie" de l'écran sur lequel vit le singe.
//
//  Toutes les coordonnées sont en pixels CSS, relatives au coin haut-gauche de
//  l'écran courant (la fenêtre transparente couvre exactement cet écran).
//  L'axe Y va vers le BAS (comme à l'écran).
//
//  Surfaces sur lesquelles il peut se tenir :
//   - le sol   : le haut de la barre des tâches (bas de la "zone de travail")
//   - les rebords : le bord supérieur des fenêtres ouvertes (bonus, Windows),
//     découpés en segments visibles (les parties cachées par une autre
//     fenêtre au premier plan sont retirées par le processus principal).
// =============================================================================

export const FLOOR = Object.freeze({ kind: 'floor' });

export class World {
  constructor() {
    this.displayId = null;
    this.bounds = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    this.workArea = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    this.neighbors = { left: [], right: [] };
    this.ledges = new Map(); // id -> { id, left, right, y, segs: [[x1, x2], ...] }
  }

  /** Informations envoyées par le processus principal (voir main.js > worldFor). */
  setDisplay(info) {
    this.displayId = info.displayId;
    this.bounds = { ...info.bounds };
    this.workArea = { ...info.workArea };
    this.neighbors = info.neighbors ?? { left: [], right: [] };
  }

  get width() {
    return this.bounds.width;
  }
  get height() {
    return this.bounds.height;
  }
  get floorY() {
    return this.workArea.y + this.workArea.height;
  }
  get minX() {
    return this.workArea.x;
  }
  get maxX() {
    return this.workArea.x + this.workArea.width;
  }
  get topY() {
    return this.workArea.y;
  }

  // ---------------------------------------------------------------------------
  //  Rebords (fenêtres)
  // ---------------------------------------------------------------------------
  setLedges(list) {
    this.ledges = new Map((list ?? []).map((l) => [l.id, l]));
  }

  /**
   * Mise à jour rapide d'UNE fenêtre suivie (déplacée, redimensionnée, fermée).
   * Retourne { dx, dy } ou { gone: true }, ou null si inconnue.
   */
  moveLedge(u) {
    const l = this.ledges.get(u.id);
    if (!l) return null;
    if (u.gone) {
      this.ledges.delete(u.id);
      return { gone: true };
    }
    const dx = u.left - l.left;
    const dy = u.y - l.y;
    l.segs = l.segs
      .map(([a, b]) => [Math.max(u.left, a + dx), Math.min(u.right, b + dx)])
      .filter(([a, b]) => b - a > 1);
    l.left = u.left;
    l.right = u.right;
    l.y = u.y;
    return { dx, dy };
  }

  /** Hauteur (y) de la surface, ou null si elle n'existe plus. */
  supportY(support) {
    if (!support) return null;
    if (support.kind === 'floor') return this.floorY;
    return this.ledges.get(support.id)?.y ?? null;
  }

  /** Segment [x1, x2] praticable de la surface au niveau de x (avec tolérance). */
  segmentAt(support, x, tol = 0) {
    if (!support) return null;
    if (support.kind === 'floor') return [this.minX, this.maxX];
    const l = this.ledges.get(support.id);
    if (!l) return null;
    for (const seg of l.segs) if (x >= seg[0] - tol && x <= seg[1] + tol) return seg;
    return null;
  }

  /**
   * En tombant de y0 à y1 (vers le bas) à l'abscisse x, touche-t-on une surface ?
   * Retourne { support, y } pour la première rencontrée.
   */
  findLanding(x, y0, y1, ignoreId = null) {
    let best = null;
    for (const l of this.ledges.values()) {
      if (l.id === ignoreId || l.y < y0 || l.y > y1) continue;
      if (!l.segs.some(([a, b]) => x >= a && x <= b)) continue;
      if (!best || l.y < best.y) best = { support: { kind: 'ledge', id: l.id }, y: l.y };
    }
    if (!best && y1 >= this.floorY) best = { support: FLOOR, y: this.floorY };
    return best;
  }

  /** Surface la plus proche sous le point (pour l'ombre). */
  groundBelow(x, y) {
    let g = this.floorY;
    for (const l of this.ledges.values()) {
      if (l.y >= y - 1 && l.y < g && l.segs.some(([a, b]) => x >= a && x <= b)) g = l.y;
    }
    return g;
  }

  /** Rebords sur lesquels il peut grimper depuis le sol. */
  climbableLedges(size, cfg) {
    const out = [];
    const minWidth = cfg.minLedgeWidth * size;
    for (const l of this.ledges.values()) {
      if (l.y > this.floorY - cfg.minHeightAboveFloor * size) continue;
      if (l.y < this.topY + cfg.minRoomAbove * size) continue;
      const segs = l.segs
        .map(([a, b]) => [Math.max(a, this.minX + size * 0.4), Math.min(b, this.maxX - size * 0.4)])
        .filter(([a, b]) => b - a >= minWidth);
      if (segs.length) out.push({ ledge: l, segs });
    }
    return out;
  }

  /** Y a-t-il un autre écran collé de ce côté (-1 gauche, 1 droite) à la hauteur y ? */
  hasNeighbor(side, y) {
    const list = side < 0 ? this.neighbors.left : this.neighbors.right;
    return list.some((r) => y >= r.top && y <= r.bottom);
  }
}
