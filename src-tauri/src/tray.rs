//! Icône et menu de la zone de notification.
//! (Le même menu s'ouvre aussi par clic droit sur le singe.)

use crate::overlay;
use crate::settings::{Settings, SIZES, SPEEDS};
use crate::system::Tracker;
use serde_json::json;
use std::sync::Mutex;
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_opener::OpenerExt as _;

const TRAY_ID: &str = "main";

/// Menu actuel (gardé pour l'ouvrir aussi par clic droit sur le singe).
pub struct CurrentMenu(pub Mutex<Option<Menu<Wry>>>);

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(include_bytes!("../icons/32x32.png"))?)
        .tooltip("Singe de bureau")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .build(app)?;
    app.manage(CurrentMenu(Mutex::new(Some(menu))));
    Ok(())
}

pub fn current_menu(app: &AppHandle) -> Option<Menu<Wry>> {
    app.try_state::<CurrentMenu>()?.0.lock().unwrap().clone()
}

/// Reconstruit le menu (cases cochées à jour).
pub fn refresh(app: &AppHandle) {
    let Ok(menu) = build_menu(app) else { return };
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_menu(Some(menu.clone()));
    }
    if let Some(current) = app.try_state::<CurrentMenu>() {
        *current.0.lock().unwrap() = Some(menu);
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let s = overlay::pet(app).settings.clone();
    let windows = Tracker::available();
    let autostart = app.autolaunch().is_enabled().unwrap_or(false);
    let item = |id: &str, text: &str| MenuItem::with_id(app, id, text, true, None::<&str>);
    let check = |id: &str, text: &str, on: bool, enabled: bool| {
        CheckMenuItem::with_id(app, id, text, enabled, on, None::<&str>)
    };
    let sep = || PredefinedMenuItem::separator(app);

    let speeds = SPEEDS
        .iter()
        .map(|(label, v)| {
            check(
                &format!("speed:{v}"),
                label,
                (s.speed - v).abs() < 1e-6,
                true,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let sizes = SIZES
        .iter()
        .map(|(label, v)| check(&format!("size:{v}"), label, (s.size - v).abs() < 1e-6, true))
        .collect::<tauri::Result<Vec<_>>>()?;

    let game = Submenu::with_id_and_items(
        app,
        "game",
        "Jeu (caca, bananes, bêtises)",
        true,
        &[
            &check("poop", "Il fait caca", s.poop, true)?,
            &check("bananas", "Des bananes tombent du ciel", s.bananas, true)?,
            &sep()?,
            &MenuItem::with_id(
                app,
                "game-label",
                "Quand il est fâché, il peut :",
                false,
                None::<&str>,
            )?,
            &check(
                "prank-windows",
                "déplacer vos fenêtres",
                s.prank_windows,
                windows,
            )?,
            &check(
                "prank-notes",
                "ouvrir des notes « DONNE BANANES !! »",
                s.prank_notes,
                true,
            )?,
            &sep()?,
            &item("drop-banana", "Faire tomber une banane")?,
            &item("clean", "Nettoyer tout le caca")?,
        ],
    )?;
    let model = Submenu::with_id_and_items(
        app,
        "model",
        "Modèle 3D et réglages",
        true,
        &[
            &item("model-folder", "Ouvrir le dossier…")?,
            &item("model-reload", "Recharger le singe")?,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "title", "Singe de bureau", false, None::<&str>)?,
            &sep()?,
            &item("pause", if s.paused { "Reprendre" } else { "Pause" })?,
            &Submenu::with_id_and_items(app, "speed", "Vitesse", true, &refs(&speeds))?,
            &Submenu::with_id_and_items(app, "size", "Taille", true, &refs(&sizes))?,
            &sep()?,
            &check(
                "climb",
                "Grimper sur les fenêtres",
                s.climb_windows,
                windows,
            )?,
            &check(
                "hidefs",
                "Se cacher pendant le plein écran",
                s.hide_on_fullscreen,
                windows,
            )?,
            &item("recall", "Rappeler le singe ici")?,
            &game,
            &sep()?,
            &check("autostart", "Lancer au démarrage", autostart, true)?,
            &model,
            &sep()?,
            &item("quit", "Quitter")?,
        ],
    )
}

fn refs<T: IsMenuItem<Wry>>(items: &[T]) -> Vec<&dyn IsMenuItem<Wry>> {
    items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect()
}

/// Un choix du menu a été cliqué.
pub fn on_menu_event(app: &AppHandle, id: &str) {
    match id {
        "pause" => update(app, |s| s.paused = !s.paused),
        "climb" => update(app, |s| s.climb_windows = !s.climb_windows),
        "hidefs" => {
            update(app, |s| s.hide_on_fullscreen = !s.hide_on_fullscreen);
            if !overlay::pet(app).settings.hide_on_fullscreen {
                overlay::set_hidden(app, false);
            }
        }
        "poop" => update(app, |s| s.poop = !s.poop),
        "bananas" => update(app, |s| s.bananas = !s.bananas),
        "prank-windows" => update(app, |s| s.prank_windows = !s.prank_windows),
        "prank-notes" => update(app, |s| s.prank_notes = !s.prank_notes),
        "drop-banana" => {
            let _ = app.emit("pet:command", json!({ "type": "banana" }));
        }
        "clean" => {
            let _ = app.emit("pet:command", json!({ "type": "clean" }));
        }
        "recall" => overlay::recall(app),
        "autostart" => {
            let launcher = app.autolaunch();
            let _ = if launcher.is_enabled().unwrap_or(false) {
                launcher.disable()
            } else {
                launcher.enable()
            };
            refresh(app);
        }
        "model-folder" => open_data_folder(app),
        "model-reload" => {
            overlay::pet(app).ready = false;
            if let Some(win) = overlay::window(app) {
                let _ = win.set_ignore_cursor_events(true);
                let _ = win.reload();
            }
        }
        "quit" => app.exit(0),
        other => {
            if let Some(v) = other
                .strip_prefix("speed:")
                .and_then(|v| v.parse::<f64>().ok())
            {
                update(app, |s| s.speed = v);
            } else if let Some(v) = other
                .strip_prefix("size:")
                .and_then(|v| v.parse::<f64>().ok())
            {
                update(app, |s| s.size = v);
            }
        }
    }
}

/// Modifie les réglages, les enregistre, prévient la page et met le menu à jour.
fn update(app: &AppHandle, change: impl FnOnce(&mut Settings)) {
    let (settings, path) = {
        let mut s = overlay::pet(app);
        change(&mut s.settings);
        s.last_ledges.clear();
        (s.settings.clone(), s.settings_path())
    };
    settings.save(&path);
    let _ = app.emit("pet:settings", &settings);
    refresh(app);
}

const README: &str = "\
DOSSIER DU SINGE DE BUREAU
==========================

Remplacer le singe par votre propre modèle 3D
  Déposez ici un fichier nommé « monkey.glb », puis choisissez
  « Modèle 3D et réglages > Recharger le singe » dans le menu de l'icône.
  Noms d'animations reconnus (un nom partiel suffit) : idle, walk, sit, sleep,
  scratch, wave, jump, fall, land, climb, drag, happy, yawn, eat, angry, poop.
  Supprimez le fichier pour revenir au singe intégré.

Changer ses réglages sans rien recompiler
  Créez ici un fichier « config.json » (en vous inspirant de
  « config-exemple.json ») : ses valeurs remplacent celles de config.js.
  Puis « Recharger le singe ».

settings.json contient les choix du menu (taille, vitesse...).
";

const CONFIG_EXAMPLE: &str = r#"{
  "movement": { "walkSpeed": 120, "gravity": 2600 },
  "weights": { "walk": 5, "climb": 1.4, "explore": 0.8 },
  "sleep": { "afterUserIdle": 120 },
  "game": { "bananaPatience": 60, "poopEvery": [300, 720], "bananaEvery": [150, 420] },
  "colors": { "fur": 9132596 }
}
"#;

fn open_data_folder(app: &AppHandle) {
    let dir = overlay::pet(app).data_dir.clone();
    let _ = std::fs::create_dir_all(&dir);
    let readme = dir.join("LISEZ-MOI.txt");
    if !readme.exists() {
        let _ = std::fs::write(&readme, README.replace('\n', "\r\n"));
    }
    let example = dir.join("config-exemple.json");
    if !example.exists() {
        let _ = std::fs::write(&example, CONFIG_EXAMPLE);
    }
    let _ = app.opener().open_path(dir.to_string_lossy(), None::<&str>);
}
