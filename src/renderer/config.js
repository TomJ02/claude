// =============================================================================
//  config.js : TOUS les réglages du singe sont ici.
//
//  Modifiez une valeur, enregistrez, puis relancez l'application
//  (ou faites Ctrl+R dans les DevTools si vous lancez avec `npm run dev`).
//
//  Unités :
//   - distances et vitesses en pixels écran (px, px/s), données pour un singe
//     de `referenceSize` px de haut. Elles sont mises à l'échelle
//     automatiquement quand vous changez la taille depuis la zone de notification.
//   - durées en secondes. Une valeur [min, max] = tirage aléatoire dans l'intervalle.
//   - angles en radians (π ≈ 3.14 = demi-tour).
// =============================================================================

export const CONFIG = {
  // Taille (en px) pour laquelle les vitesses ci-dessous sont exprimées.
  referenceSize: 125,

  // ---------------------------------------------------------------------------
  //  Déplacements et physique
  // ---------------------------------------------------------------------------
  movement: {
    walkSpeed: 70, // vitesse de marche normale (px/s)
    followSpeed: 120, // vitesse quand il suit la souris (px/s)
    climbSpeed: 85, // vitesse d'escalade le long d'une fenêtre (px/s)
    acceleration: 260, // accélération / freinage au départ et à l'arrivée (px/s²)
    gravity: 2600, // gravité (px/s²)
    hopHeight: 0.45, // hauteur d'un petit saut, en multiples de la taille du singe
    jumpDownSpeed: 160, // élan horizontal quand il saute d'une fenêtre (px/s)
    airDrag: 0.8, // freinage horizontal dans les airs (par seconde)
    wallBounce: 0.35, // rebond sur les bords de l'écran (0 = aucun, 1 = parfait)
    maxThrowSpeed: 2400, // vitesse maximale quand on le lance (px/s)
    hardLandingSpeed: 1500, // au-delà, l'atterrissage l'étourdit (px/s)
  },

  // ---------------------------------------------------------------------------
  //  Durées des activités (secondes, [min, max])
  // ---------------------------------------------------------------------------
  durations: {
    idle: [1.2, 3.5], // debout à regarder autour de lui
    sit: [5, 12], // assis
    sleep: [25, 70], // sieste "naturelle" (quand il est fatigué)
    scratch: [2.2, 2.8], // se gratter la tête
    wave: [1.8, 2.4], // faire coucou
    happy: [1.4, 1.8], // content (quand on le caresse)
    yawn: [1.6, 1.6], // bâillement avant de dormir
    dizzy: [1.2, 1.6], // étourdi après une grosse chute
    pauseBetweenSteps: [0.3, 1.2], // petite pause entre deux marches consécutives
  },

  // ---------------------------------------------------------------------------
  //  Choix de la prochaine activité : poids relatifs (plus = plus fréquent).
  //  Mettez 0 pour supprimer une activité. Certains poids varient avec son
  //  énergie (voir plus bas) : ↑ = plus fréquent quand il est en forme,
  //  ↓ = plus fréquent quand il est fatigué.
  // ---------------------------------------------------------------------------
  weights: {
    walk: 5, // ↑ marcher vers un point au hasard
    sit: 2.5, // ↓ s'asseoir (puis peut-être s'endormir)
    scratch: 1, // se gratter la tête
    wave: 0.5, // faire coucou sans raison
    hop: 0.6, // ↑ petit saut sur place
    climb: 1.4, // ↑ grimper sur une fenêtre (si l'option est activée)
    jumpDown: 1.2, // ↓ redescendre d'une fenêtre
    explore: 0.8, // ↑ partir à pied sur un autre écran (multi-écran)
  },

  // ---------------------------------------------------------------------------
  //  Énergie (0 = épuisé, 1 = en pleine forme) : alterne phases actives et repos.
  // ---------------------------------------------------------------------------
  energy: {
    start: 1,
    drainWalk: 0.012, // perdu par seconde de marche
    drainClimb: 0.03, // perdu par seconde d'escalade
    drainJump: 0.04, // perdu à chaque saut
    regenIdle: 0.004, // regagné par seconde debout
    regenSit: 0.02, // regagné par seconde assis
    regenSleep: 0.045, // regagné par seconde de sommeil
    sleepBelow: 0.28, // en dessous, il a des chances de s'endormir quand il est assis
  },

  // ---------------------------------------------------------------------------
  //  Sommeil lié à VOTRE inactivité (clavier/souris du PC).
  // ---------------------------------------------------------------------------
  sleep: {
    afterUserIdle: 120, // il s'endort si vous n'avez pas touché le PC depuis N secondes
    wakeDelay: [1, 4], // délai avant qu'il se réveille quand vous revenez
  },

  // ---------------------------------------------------------------------------
  //  Interaction avec la souris
  // ---------------------------------------------------------------------------
  cursor: {
    followRadius: 190, // le curseur est "proche" sous cette distance (px)
    followChance: 0.35, // probabilité de le suivre quand le curseur s'approche
    followCooldown: 12, // délai minimum entre deux poursuites (s)
    followMaxDuration: 9, // durée maximale d'une poursuite (s)
    followGiveUp: 520, // il abandonne si le curseur s'éloigne au-delà (px)
    lookRadius: 420, // il tourne la tête vers le curseur sous cette distance (px)
    clickMaxDuration: 0.35, // un appui plus court = un clic (s)
    dragThreshold: 6, // déplacement (px) au-delà duquel un appui devient un glisser
    petDistance: 3.2, // caresse : distance parcourue sur lui (× taille) ...
    petWindow: 1.5, // ... en moins de N secondes
  },

  // ---------------------------------------------------------------------------
  //  Jeu : caca, bananes et bêtises (activables dans le menu "Jeu").
  // ---------------------------------------------------------------------------
  game: {
    poopEvery: [300, 720], // il fait caca toutes les 5 à 12 min environ...
    poopAfterEating: [25, 70], // ... ou peu de temps après avoir mangé une banane
    maxPoops: 6, // au-delà, il attend que vous nettoyiez
    bananaEvery: [150, 420], // une banane tombe du ciel toutes les 2 min 30 à 7 min
    maxBananas: 3,
    bananaPatience: 60, // secondes avant qu'il se fâche si on ne lui donne pas la banane
    mischiefEvery: [25, 45], // fâché : une bêtise toutes les 25 à 45 s jusqu'à ce qu'il soit nourri
    noteCooldown: 90, // au moins 90 s entre deux notes "donne bananes !!"
    windowShove: [140, 320], // de combien (px) il pousse une fenêtre
    eatDuration: 3.2, // durée du repas (s)
    giveRadius: 0.6, // lâcher la banane à moins de N × taille de lui = la lui donner
  },

  // ---------------------------------------------------------------------------
  //  Fenêtres (bonus) : grimper / s'asseoir sur le bord supérieur des fenêtres.
  // ---------------------------------------------------------------------------
  windows: {
    minLedgeWidth: 1.1, // largeur visible minimale d'un rebord (× taille)
    minHeightAboveFloor: 1.3, // hauteur minimale au-dessus du sol (× taille)
    minRoomAbove: 1.0, // place libre minimale au-dessus du rebord (× taille)
    jumpUpMaxHeight: 1.6, // en dessous de cette hauteur (× taille) il saute au lieu de grimper
  },

  // ---------------------------------------------------------------------------
  //  Rendu et performances
  // ---------------------------------------------------------------------------
  render: {
    fpsActive: 60, // quand il bouge
    fpsCalm: 30, // debout / assis sans bouger (respiration, clignements)
    fpsSleep: 20, // quand il dort
    maxPixelRatio: 2, // limite la résolution sur les écrans très denses
    antialias: true,
    outline: true, // contour "cartoon" sombre
    outlineWidth: 0.022, // épaisseur du contour (unités du modèle)
    flatShading: true, // true = facettes "low-poly", false = plus lisse
    sideYaw: 0.9, // rotation (rad) quand il marche de côté (π/2 = profil strict)
    turnSpeed: 7, // vitesse de rotation (rad/s)
    shadow: true, // petite ombre au sol
  },

  // ---------------------------------------------------------------------------
  //  Couleurs du singe procédural (format 0xRRGGBB)
  // ---------------------------------------------------------------------------
  colors: {
    fur: 0x8b5a34, // pelage
    furDark: 0x6a4024, // touffe de poils, détails
    skin: 0xf2d0a4, // visage, ventre, mains, pieds
    earInner: 0xe9b48f, // intérieur des oreilles
    eyes: 0x1b120c,
    mouth: 0x5b2a1b,
    blush: 0xff8f9c, // joues
    outline: 0x2a1910,
  },

  // ---------------------------------------------------------------------------
  //  Modèle .glb personnalisé (voir README, section "Remplacer le modèle 3D").
  //  Noms d'animations recherchés dans le fichier, par ordre de préférence
  //  (la casse est ignorée, un nom partiel suffit : "Walk_Cycle" correspond à "walk").
  // ---------------------------------------------------------------------------
  glb: {
    rotationY: 0, // rotation à appliquer si votre modèle ne regarde pas vers l'avant (+Z)
    headLook: true, // tourner l'os "head" vers le curseur (désactivez si le résultat est bizarre)
    clips: {
      idle: ['idle', 'stand', 'breath'],
      walk: ['walk', 'run'],
      sit: ['sit'],
      sitLedge: ['sitledge', 'sit_ledge', 'sit'],
      sleep: ['sleep', 'lie', 'rest'],
      yawn: ['yawn', 'stretch'],
      scratch: ['scratch'],
      scratchSit: ['scratchsit', 'scratch_sit', 'scratch'],
      wave: ['wave', 'hello', 'coucou'],
      happy: ['happy', 'dance', 'cheer'],
      crouch: ['crouch', 'jump_start'],
      air: ['jump', 'air'],
      land: ['land'],
      fall: ['fall', 'falling'],
      dragged: ['drag', 'hang', 'grab'],
      climb: ['climb'],
      dizzy: ['dizzy', 'hit'],
      poop: ['poop', 'squat'],
      eat: ['eat'],
      angry: ['angry', 'stomp', 'tantrum'],
      beg: ['beg', 'point'],
      type: ['type', 'typing'],
    },
  },
};
