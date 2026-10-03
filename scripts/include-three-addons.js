// Hook electron-builder (voir "onNodeModuleFile" dans package.json).
// Par défaut, electron-builder exclut les dossiers "examples" des modules
// node. Or le chargeur de modèles .glb de three.js (GLTFLoader) s'y trouve :
// on force donc l'inclusion de three/examples ; le tri fin (ne garder que
// GLTFLoader et ses dépendances) est fait par les motifs "files" de package.json.
module.exports = (file) => (/[\\/]three[\\/]examples([\\/]|$)/.test(file) ? true : undefined);
