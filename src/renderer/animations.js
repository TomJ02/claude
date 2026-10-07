// =============================================================================
//  animations.js : les animations du singe procédural.
//
//  Une "pose" est un simple objet de nombres (angles des articulations,
//  expressions du visage...). Chaque animation est une fonction
//      (pose, params) => void
//  qui part de la pose de repos (REST_POSE) et modifie ce qu'elle veut.
//  `params` contient :
//      t      : temps écoulé depuis le début de l'animation (s)
//      phase  : phase du cycle de marche / d'escalade (radians, avance avec la vitesse)
//      swing  : balancement quand on le porte (rad)
//
//  Le moteur (monkey.js) fait des fondus entre animations : vous pouvez donc
//  modifier un angle ici sans vous soucier des transitions.
//
//  Conventions (angles en radians) :
//   - "L" = côté gauche DU SINGE = à droite de l'écran quand il vous fait face.
//   - ...Fwd   : balancement vers l'avant (+) ou l'arrière (−)
//   - ...Raise : écarte le bras sur le côté (+ = vers l'extérieur / le haut)
//   - foreXBend: plie le coude (+ = avant-bras vers l'avant)
//   - foreXSide: balance l'avant-bras sur le côté (pour faire coucou)
//   - kneeX    : plie le genou (+ = pied vers l'arrière)
//   - headNod  : + = baisse la tête ; headTurn : + = tourne vers SA gauche
//   - hipsY    : abaisse (−) ou lève (+) le corps (le singe mesure ~2 unités)
// =============================================================================

export const REST_POSE = Object.freeze({
  hipsX: 0,
  hipsY: 0,
  bodyLean: 0,
  bodyRoll: 0, // + = penche vers SA gauche
  bodyTurn: 0,
  squash: 1, // < 1 = écrasé, > 1 = étiré
  chestLean: 0,
  chestRoll: 0,
  chestTurn: 0,
  headNod: 0,
  headTurn: 0,
  headTilt: 0, // + = incline vers SA gauche
  armLRaise: 0.14,
  armLFwd: 0,
  armLTwist: 0,
  foreLBend: 0.3,
  foreLSide: 0,
  armRRaise: 0.14,
  armRFwd: 0,
  armRTwist: 0,
  foreRBend: 0.3,
  foreRSide: 0,
  legLFwd: 0,
  legLOut: 0.05,
  kneeL: 0.06,
  legRFwd: 0,
  legROut: 0.05,
  kneeR: 0.06,
  tailCurl: 0.3, // enroulement de la queue (par segment)
  tailSwing: 0, // balancement latéral de la queue
  tailLift: 0, // + = queue relevée
  eyesOpen: 1, // 0 = fermés, 1 = ouverts
  eyesMode: 0, // 0 = normaux, 1 = fermés endormis (‿ ‿), 2 = fermés heureux (^ ^)
  mouthOpen: 0, // 0 = sourire, 1 = bouche grande ouverte
  blush: 0.7, // intensité des joues roses (0..1)
  brows: 0, // sourcils froncés (0 = invisibles, 1 = très fâché)
  swing: 0, // rotation de tout le corps autour du point de prise (quand on le porte)
});

export const POSE_KEYS = Object.keys(REST_POSE);
// Ces valeurs ne se mélangent pas (on bascule à mi-transition).
export const DISCRETE_KEYS = new Set(['eyesMode']);

const { sin, cos, abs, max, PI } = Math;

// Respiration douce, réutilisée par plusieurs animations.
function breathe(p, t, amount = 0.014, speed = 2.2) {
  p.squash = 1 + sin(t * speed) * amount;
}

// Pose assise de base (au sol) : jambes devant, mains posées.
function sitBase(p, t) {
  p.hipsY = -0.33;
  p.legLFwd = p.legRFwd = 1.45;
  p.legLOut = p.legROut = 0.32;
  p.kneeL = p.kneeR = -0.05;
  p.armLFwd = p.armRFwd = 0.5;
  p.armLRaise = p.armRRaise = 0.36;
  p.foreLBend = p.foreRBend = 0.55;
  p.bodyLean = -0.04;
  p.tailCurl = 0.16;
  p.tailLift = -0.45;
  p.tailSwing = sin(t * 0.9) * 0.15;
  breathe(p, t, 0.012, 2.0);
}

// -----------------------------------------------------------------------------
//  Les animations. `lookWeight` = à quel point il peut tourner la tête vers le
//  curseur pendant cette animation (0 = jamais, 1 = librement).
// -----------------------------------------------------------------------------
export const ANIMATIONS = {
  // Debout, respire, se balance un peu.
  idle: {
    lookWeight: 1,
    pose(p, { t }) {
      breathe(p, t);
      p.armLRaise = 0.14 + sin(t * 2.2) * 0.02;
      p.armRRaise = 0.14 + sin(t * 2.2 + 0.4) * 0.02;
      p.bodyRoll = sin(t * 0.7) * 0.025;
      p.hipsX = sin(t * 0.7) * 0.01;
      p.tailSwing = sin(t * 1.3) * 0.25;
      p.tailLift = 0.1 + sin(t * 0.8) * 0.08;
    },
  },

  // Marche : le cycle avance avec `phase` (lié à la vitesse réelle pour que les
  // pieds ne glissent pas).
  walk: {
    lookWeight: 0.55,
    pose(p, { phase }) {
      const s = sin(phase);
      const c = cos(phase);
      p.legLFwd = s * 0.62;
      p.legRFwd = -s * 0.62;
      p.kneeL = 0.12 + max(0, c) * 0.95; // le genou plie quand la jambe revient vers l'avant
      p.kneeR = 0.12 + max(0, -c) * 0.95;
      p.armLFwd = -s * 0.55;
      p.armRFwd = s * 0.55;
      p.armLRaise = p.armRRaise = 0.2;
      p.foreLBend = p.foreRBend = 0.55;
      p.hipsY = -0.03 + abs(c) * 0.045; // petit rebond à chaque pas
      p.bodyRoll = s * 0.07; // dandinement
      p.bodyLean = 0.1;
      p.headNod = -0.03;
      p.headTilt = -s * 0.05;
      p.tailSwing = s * 0.35;
      p.tailLift = 0.25;
    },
  },

  // Assis par terre.
  sit: {
    lookWeight: 1,
    pose(p, { t }) {
      sitBase(p, t);
    },
  },

  // Assis sur le bord d'une fenêtre : les jambes pendent et se balancent.
  sitLedge: {
    lookWeight: 1,
    pose(p, { t }) {
      sitBase(p, t);
      p.legLFwd = p.legRFwd = 1.45;
      p.legLOut = p.legROut = 0.16;
      p.kneeL = 1.45 + sin(t * 2.4) * 0.3;
      p.kneeR = 1.45 + sin(t * 2.4 + PI) * 0.3;
      p.armLRaise = p.armRRaise = 0.5;
      p.armLFwd = p.armRFwd = 0.15;
      p.foreLBend = p.foreRBend = 0.25;
      p.tailLift = -1.2;
      p.tailCurl = 0.08;
    },
  },

  // Bâillement + étirement (avant de dormir / au réveil).
  yawn: {
    lookWeight: 0,
    pose(p, { t }) {
      sitBase(p, t);
      const k = Math.min(1, t / 0.5) * (t < 1.2 ? 1 : Math.max(0, 1 - (t - 1.2) / 0.4));
      p.armLRaise = p.armRRaise = 0.36 + k * 2.1;
      p.armLFwd = p.armRFwd = 0.5 - k * 0.2;
      p.foreLBend = p.foreRBend = 0.55 - k * 0.3;
      p.headNod = -0.35 * k;
      p.bodyLean = -0.04 - 0.12 * k;
      p.mouthOpen = k;
      p.eyesMode = k > 0.3 ? 1 : 0;
    },
  },

  // Dort couché sur le côté, en boule.
  sleep: {
    lookWeight: 0,
    pose(p, { t }) {
      p.hipsY = -0.22;
      p.hipsX = 0.42;
      p.bodyRoll = -1.35; // couché sur le côté (tête vers la gauche de l'écran)
      p.bodyLean = 0.1;
      p.legLFwd = p.legRFwd = 1.25;
      p.legLOut = 0.05;
      p.legROut = 0.25;
      p.kneeL = p.kneeR = 1.7;
      p.armLFwd = p.armRFwd = 1.0;
      p.armLRaise = 0.1;
      p.armRRaise = 0.3;
      p.foreLBend = p.foreRBend = 1.7;
      p.headTilt = 0.95; // redresse la tête pour qu'elle repose sur la joue
      p.headNod = 0.1;
      p.tailCurl = 0.42;
      p.tailLift = -0.3;
      p.eyesMode = 1;
      p.eyesOpen = 0;
      p.blush = 1;
      const b = sin(t * 1.4); // respiration lente et profonde
      p.squash = 1 + b * 0.025;
      p.chestLean = b * 0.03;
    },
  },

  // Se gratte la tête avec la main gauche, l'air perplexe.
  scratch: {
    lookWeight: 0.3,
    pose(p, { t }) {
      breathe(p, t);
      p.armLRaise = 2.35;
      p.armLFwd = 0.35;
      p.armLTwist = 0.3;
      p.foreLBend = 2.15 + sin(t * 22) * 0.18; // grattouille rapide
      p.headTilt = -0.25;
      p.headNod = 0.08;
      p.bodyRoll = -0.06;
      p.eyesOpen = 0.55;
      p.armRRaise = 0.1;
      p.tailSwing = sin(t * 3) * 0.3;
    },
  },

  // Variante assise du grattage.
  scratchSit: {
    lookWeight: 0.3,
    pose(p, params) {
      sitBase(p, params.t);
      const { t } = params;
      p.armLRaise = 2.35;
      p.armLFwd = 0.35;
      p.armLTwist = 0.3;
      p.foreLBend = 2.15 + sin(t * 22) * 0.18;
      p.headTilt = -0.25;
      p.headNod = 0.08;
      p.eyesOpen = 0.55;
    },
  },

  // Fait coucou de la main gauche, tout sourire.
  wave: {
    lookWeight: 0.5,
    pose(p, { t }) {
      breathe(p, t);
      p.armLRaise = 1.75;
      p.armLFwd = 0.2;
      p.foreLBend = 0.2;
      p.foreLSide = 0.55 + sin(t * 10) * 0.4;
      p.headTilt = 0.12 + sin(t * 5) * 0.06;
      p.bodyRoll = sin(t * 5) * 0.04;
      p.armRRaise = 0.25;
      p.mouthOpen = 0.55;
      p.blush = 1;
      p.tailSwing = sin(t * 5) * 0.45;
      p.tailLift = 0.4;
    },
  },

  // Content (caresses) : yeux ^ ^ et petit dandinement.
  happy: {
    lookWeight: 0.2,
    pose(p, { t }) {
      breathe(p, t);
      p.eyesMode = 2;
      p.mouthOpen = 0.35;
      p.blush = 1;
      p.bodyRoll = sin(t * 8) * 0.08;
      p.headTilt = sin(t * 8) * 0.12;
      p.armLRaise = p.armRRaise = 0.5 + sin(t * 8) * 0.1;
      p.foreLBend = p.foreRBend = 1.2;
      p.armLFwd = p.armRFwd = 0.4;
      p.tailSwing = sin(t * 8) * 0.6;
      p.tailLift = 0.5;
    },
  },

  // Préparation d'un saut (accroupi).
  crouch: {
    lookWeight: 0.2,
    pose(p) {
      p.hipsY = -0.13;
      p.legLFwd = p.legRFwd = 0.7;
      p.kneeL = p.kneeR = 1.25;
      p.legLOut = p.legROut = 0.18;
      p.bodyLean = 0.32;
      p.armLFwd = p.armRFwd = -0.7;
      p.armLRaise = p.armRRaise = 0.3;
      p.squash = 0.93;
      p.headNod = -0.2;
    },
  },

  // En l'air pendant un saut joyeux.
  air: {
    lookWeight: 0.2,
    pose(p, { t }) {
      p.armLRaise = p.armRRaise = 2.1 + sin(t * 9) * 0.1;
      p.armLFwd = p.armRFwd = 0.35;
      p.foreLBend = p.foreRBend = 0.3;
      p.legLFwd = p.legRFwd = 0.75;
      p.kneeL = p.kneeR = 1.3;
      p.legLOut = p.legROut = 0.2;
      p.squash = 1.04;
      p.mouthOpen = 0.6;
      p.eyesMode = 2;
      p.blush = 1;
      p.tailLift = 0.6;
    },
  },

  // Atterrissage : écrasement puis retour à la normale.
  land: {
    lookWeight: 0,
    pose(p, { t }) {
      const k = Math.exp(-t * 9);
      p.squash = 1 - 0.2 * k * cos(t * 18);
      p.hipsY = -0.12 * k;
      p.legLFwd = p.legRFwd = 0.5 * k;
      p.kneeL = p.kneeR = 0.06 + 1.0 * k;
      p.legLOut = p.legROut = 0.05 + 0.2 * k;
      p.armLRaise = p.armRRaise = 0.14 + 0.9 * k;
      p.bodyLean = 0.2 * k;
    },
  },

  // Chute : bras et jambes qui gigotent, bouche en "O".
  fall: {
    lookWeight: 0,
    pose(p, { t }) {
      p.armLRaise = 2.3 + sin(t * 15) * 0.35;
      p.armRRaise = 2.3 + sin(t * 15 + 1.5) * 0.35;
      p.armLFwd = p.armRFwd = 0.2;
      p.foreLBend = p.foreRBend = 0.2;
      p.legLFwd = sin(t * 13) * 0.5;
      p.legRFwd = -sin(t * 13) * 0.5;
      p.kneeL = p.kneeR = 0.5;
      p.legLOut = p.legROut = 0.25;
      p.mouthOpen = 0.9;
      p.eyesOpen = 1;
      p.tailLift = 1.0;
      p.tailSwing = sin(t * 9) * 0.5;
    },
  },

  // Porté par la souris : pend, les jambes se balancent avec le mouvement.
  dragged: {
    lookWeight: 0.4,
    pose(p, { t, swing }) {
      p.swing = swing;
      p.armLRaise = 0.7 + sin(t * 6) * 0.15;
      p.armRRaise = 0.7 + sin(t * 6 + 2) * 0.15;
      p.armLFwd = p.armRFwd = 0.3;
      p.foreLBend = p.foreRBend = 0.9;
      p.legLFwd = sin(t * 4.5) * 0.35 - swing * 0.6;
      p.legRFwd = -sin(t * 4.5) * 0.35 - swing * 0.6;
      p.kneeL = p.kneeR = 0.35;
      p.legLOut = p.legROut = 0.12;
      p.headNod = 0.1;
      p.eyesMode = 2;
      p.mouthOpen = 0.5;
      p.blush = 1;
      p.tailLift = -1.0;
      p.tailSwing = -swing * 1.2;
    },
  },

  // Escalade (vu de dos) : bras et jambes alternés.
  climb: {
    lookWeight: 0,
    pose(p, { phase }) {
      const s = sin(phase);
      p.bodyLean = 0.22;
      p.armLFwd = 2.3 + s * 0.35;
      p.armRFwd = 2.3 - s * 0.35;
      p.armLRaise = p.armRRaise = 0.9;
      p.foreLBend = 0.5 - s * 0.35;
      p.foreRBend = 0.5 + s * 0.35;
      p.legLFwd = 0.7 - s * 0.5;
      p.legRFwd = 0.7 + s * 0.5;
      p.kneeL = 1.1 - s * 0.4;
      p.kneeR = 1.1 + s * 0.4;
      p.legLOut = p.legROut = 0.3;
      p.hipsY = -0.08;
      p.tailLift = 0.2;
      p.tailSwing = s * 0.3;
    },
  },

  // Étourdi après une grosse chute : la tête tourne.
  dizzy: {
    lookWeight: 0,
    pose(p, { t }) {
      sitBase(p, t);
      p.headTilt = sin(t * 6) * 0.25;
      p.headNod = cos(t * 6) * 0.12;
      p.bodyRoll = sin(t * 6) * 0.08;
      p.eyesMode = 1;
      p.mouthOpen = 0.3;
    },
  },
  // Fait caca : accroupi, il pousse (yeux plissés, joues rouges), puis soulagé.
  poop: {
    lookWeight: 0,
    pose(p, { t }) {
      p.hipsY = -0.1;
      p.legLFwd = p.legRFwd = 0.55;
      p.legLOut = p.legROut = 0.42;
      p.kneeL = p.kneeR = 0.9;
      p.bodyLean = 0.22;
      p.armLFwd = p.armRFwd = 0.75;
      p.armLRaise = p.armRRaise = 0.35;
      p.foreLBend = p.foreRBend = 0.7;
      p.tailLift = 1.1;
      p.tailCurl = 0.12;
      if (t < 1.7) {
        p.hipsX = sin(t * 38) * 0.008; // il tremble en poussant
        p.squash = 0.97 + sin(t * 3) * 0.02;
        p.eyesMode = 1;
        p.brows = 0.6;
        p.blush = 1;
        p.headNod = 0.1;
      } else {
        p.eyesMode = 2; // ouf !
        p.mouthOpen = 0.3;
        p.headNod = -0.12;
        p.squash = 1.02;
      }
    },
  },

  // Mange une banane (tenue à deux mains), en mâchant.
  eat: {
    lookWeight: 0.2,
    pose(p, { t }) {
      sitBase(p, t);
      p.armLFwd = p.armRFwd = 0.85;
      p.armLRaise = p.armRRaise = 0.3;
      p.armLTwist = p.armRTwist = -0.3;
      p.foreLBend = p.foreRBend = 1.3;
      const chew = max(0, sin(t * 9));
      p.mouthOpen = 0.2 + chew * 0.35;
      p.headNod = 0.06 + chew * 0.05;
      p.eyesMode = 2;
      p.blush = 1;
      p.tailSwing = sin(t * 4) * 0.4;
      p.tailLift = 0.1;
    },
  },

  // Colère : trépigne, poings en l'air, sourcils froncés.
  angry: {
    lookWeight: 0.3,
    pose(p, { t }) {
      const s = sin(t * 13);
      p.legLFwd = max(0, s) * 0.45;
      p.kneeL = max(0, s) * 0.9;
      p.legRFwd = max(0, -s) * 0.45;
      p.kneeR = max(0, -s) * 0.9;
      p.hipsY = -0.02 - abs(s) * 0.03;
      p.armLRaise = 2.3 + s * 0.25;
      p.armRRaise = 2.3 - s * 0.25;
      p.foreLBend = p.foreRBend = 1.2;
      p.bodyRoll = s * 0.06;
      p.headNod = -0.08;
      p.mouthOpen = 0.65 + abs(s) * 0.2;
      p.brows = 1;
      p.blush = 1;
      p.eyesOpen = 0.9;
      p.tailLift = 0.9;
      p.tailSwing = s * 0.6;
    },
  },

  // Réclame la banane : la montre du doigt en sautillant.
  beg: {
    lookWeight: 0.6,
    pose(p, { t }) {
      breathe(p, t);
      const hop = abs(sin(t * 7));
      p.hipsY = hop * 0.04;
      p.armLRaise = 0.6;
      p.armLFwd = 1.45;
      p.foreLBend = 0.05;
      p.armRRaise = 0.5 + sin(t * 7) * 0.2;
      p.armRFwd = 0.6;
      p.foreRBend = 1.0;
      p.mouthOpen = 0.45;
      p.blush = 0.9;
      p.tailSwing = sin(t * 7) * 0.5;
      p.tailLift = 0.5;
    },
  },

  // Tape une note sur un clavier imaginaire, l'air déterminé.
  type: {
    lookWeight: 0,
    pose(p, { t }) {
      sitBase(p, t);
      p.armLFwd = p.armRFwd = 1.0;
      p.armLRaise = p.armRRaise = 0.25;
      p.foreLBend = 0.8 + max(0, sin(t * 20)) * 0.35;
      p.foreRBend = 0.8 + max(0, -sin(t * 20)) * 0.35;
      p.headNod = 0.3;
      p.brows = 1;
      p.tailSwing = sin(t * 6) * 0.3;
    },
  },
};

export function createPose() {
  return { ...REST_POSE };
}

export function copyPose(dst, src) {
  for (const k of POSE_KEYS) dst[k] = src[k];
  return dst;
}

// Fondu linéaire entre deux poses (w = 0 → a, w = 1 → b).
export function lerpPose(out, a, b, w) {
  for (const k of POSE_KEYS) {
    out[k] = DISCRETE_KEYS.has(k) ? (w < 0.5 ? a[k] : b[k]) : a[k] + (b[k] - a[k]) * w;
  }
  return out;
}
