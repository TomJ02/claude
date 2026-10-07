//! Réglages persistants (settings.json dans le dossier de données de l'appli,
//! ex. `%APPDATA%\com.singedebureau.app\settings.json`).

use serde::{Deserialize, Serialize};
use std::path::Path;

/// Choix proposés dans le menu "Vitesse" (libellé, multiplicateur).
pub const SPEEDS: &[(&str, f64)] = &[
    ("Tortue (×0,5)", 0.5),
    ("Normale (×1)", 1.0),
    ("Rapide (×1,5)", 1.5),
    ("Turbo (×2)", 2.0),
];

/// Choix proposés dans le menu "Taille" (libellé, hauteur en pixels).
pub const SIZES: &[(&str, f64)] = &[
    ("Petit (100 px)", 100.0),
    ("Moyen (125 px)", 125.0),
    ("Grand (150 px)", 150.0),
    ("Très grand (200 px)", 200.0),
];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub paused: bool,
    /// Multiplicateur des vitesses de déplacement.
    pub speed: f64,
    /// Hauteur du singe en pixels.
    pub size: f64,
    /// Grimper / s'asseoir sur les fenêtres (Windows).
    pub climb_windows: bool,
    /// Se cacher quand une appli est en plein écran (Windows).
    pub hide_on_fullscreen: bool,
    // Jeu
    pub poop: bool,
    pub bananas: bool,
    pub prank_windows: bool,
    pub prank_notes: bool,
    /// Dernier écran où se trouvait le singe.
    pub last_display: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            paused: false,
            speed: 1.0,
            size: 125.0,
            climb_windows: true,
            hide_on_fullscreen: true,
            poop: true,
            bananas: true,
            prank_windows: true,
            prank_notes: true,
            last_display: None,
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
            .map(Settings::sanitize)
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(self) {
            if let Err(err) = std::fs::write(path, json) {
                eprintln!("[singe] impossible d'enregistrer les réglages : {err}");
            }
        }
    }

    fn sanitize(mut self) -> Self {
        if !(self.speed > 0.0 && self.speed <= 5.0) {
            self.speed = 1.0;
        }
        if !(40.0..=600.0).contains(&self.size) {
            self.size = 125.0;
        }
        self
    }
}
