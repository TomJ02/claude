//! Bêtises du singe fâché (seulement si elles sont cochées dans le menu "Jeu").

use crate::overlay;
use serde::Deserialize;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt as _;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Prank {
    /// Ouvre une note "DONNE BANANES !!" (de plus en plus insistante).
    Note { count: u32 },
    /// Fait glisser une fenêtre (déplacement en pixels de la page).
    MoveWindow { id: String, dx: f64, dy: f64 },
}

pub fn run(app: &AppHandle, prank: Prank) {
    let (settings, display) = {
        let s = overlay::pet(app);
        (s.settings.clone(), s.display.clone())
    };
    match prank {
        Prank::Note { count } if settings.prank_notes => {
            if let Some(path) = write_note(count) {
                let _ = app.opener().open_path(path.to_string_lossy(), None::<&str>);
            }
        }
        Prank::MoveWindow { id, dx, dy }
            if settings.prank_windows && dx.is_finite() && dy.is_finite() =>
        {
            // La page parle en pixels logiques, Windows en pixels réels.
            let dx = (dx.clamp(-800.0, 800.0) * display.scale).round() as i32;
            let dy = (dy.clamp(-400.0, 400.0) * display.scale).round() as i32;
            overlay::tracker(app).move_by(&id, dx, dy, 900);
        }
        _ => {}
    }
}

/// Écrit la note dans le dossier temporaire et retourne son chemin.
pub fn write_note(count: u32) -> Option<PathBuf> {
    let n = count.clamp(1, 99);
    let path = std::env::temp_dir().join(format!(
        "DONNE BANANES {}.txt",
        "!".repeat(1 + n.min(8) as usize)
    ));
    let mut lines = vec![
        "🍌🍌🍌   DONNE BANANES !!   🍌🍌🍌".to_string(),
        String::new(),
    ];
    lines.extend(
        (0..(2 + n * 3).min(40))
            .map(|i| format!("DONNE BANANES {}", "!".repeat(2 + (i % 5) as usize))),
    );
    lines.push(String::new());
    if n > 1 {
        lines.push(format!("(c'est la {n}e fois que je demande...)"));
    }
    lines.push("— ton singe, pas content du tout 😠".into());
    std::fs::write(&path, lines.join("\r\n")).ok()?;
    Some(path)
}
