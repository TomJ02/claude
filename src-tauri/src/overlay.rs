//! La fenêtre transparente du singe.
//!
//! - Elle couvre l'écran où se trouve le singe et "saute" d'un écran à l'autre.
//! - Elle laisse passer les clics (set_ignore_cursor_events) sauf quand le
//!   curseur est sur le singe : comme une fenêtre qui laisse passer les clics
//!   ne reçoit plus la souris, on envoie nous-mêmes la position du curseur à la
//!   page ~60 fois/s ; la page teste le survol et nous dit quand basculer.
//! - Elle surveille les fenêtres ouvertes (Windows), l'inactivité, les écrans.
//!
//! Attention aux verrous : ne jamais appeler une fonction de fenêtre Tauri en
//! tenant le verrou de `PetState` (ces fonctions attendent le fil principal).

use crate::settings::Settings;
use crate::system::{self, Tracker};
use serde::Serialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const LABEL: &str = "pet";

// Fréquences de surveillance (plus grand = moins de CPU)
const CURSOR_EVERY: Duration = Duration::from_millis(16); // position du curseur
const TICK: Duration = Duration::from_millis(50); // fenêtre sous le singe (il suit ses mouvements)
const SCAN_EVERY: u32 = 20; // × TICK = 1 s : liste des fenêtres, plein écran
const TOPMOST_EVERY: u32 = 80; // × TICK = 4 s : repasser au premier plan
const IDLE_EVERY: u32 = 100; // × TICK = 5 s : inactivité de l'utilisateur
const DISPLAYS_EVERY: u32 = 40; // × TICK = 2 s : écrans branchés / débranchés

pub type PetState = Mutex<Pet>;
pub type TrackerState = Mutex<Tracker>;

/// Un écran (pixels physiques).
#[derive(Clone, Debug, PartialEq)]
pub struct Display {
    pub id: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    /// Zone de travail (sans la barre des tâches)
    pub work: (i32, i32, i32, i32),
    pub scale: f64,
}

impl Display {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x as f64
            && y >= self.y as f64
            && x < (self.x + self.w) as f64
            && y < (self.y + self.h) as f64
    }
    /// Pixels physiques du bureau → pixels CSS de la page.
    pub fn to_local(&self, x: f64, y: f64) -> (f64, f64) {
        (
            (x - self.x as f64) / self.scale,
            (y - self.y as f64) / self.scale,
        )
    }
    /// Pixels CSS de la page → pixels physiques du bureau.
    pub fn to_global(&self, x: f64, y: f64) -> (f64, f64) {
        (
            self.x as f64 + x * self.scale,
            self.y as f64 + y * self.scale,
        )
    }
}

/// État partagé du programme.
pub struct Pet {
    pub settings: Settings,
    pub data_dir: PathBuf,
    pub display: Display,
    pub own: isize,
    /// La page a démarré (sinon inutile d'envoyer des messages).
    pub ready: bool,
    pub ignoring: bool,
    pub dragging: bool,
    /// Fenêtre sous le singe, suivie de près.
    pub tracked: Option<String>,
    /// Caché parce qu'une appli est en plein écran.
    pub hidden: bool,
    pub last_ledges: String,
    pub last_track: String,
    pub last_cursor: Option<(i32, i32)>,
    pub cursor_inside: bool,
    pub displays_sig: String,
}

impl Pet {
    pub fn settings_path(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }
}

/// Journal de débogage (variable d'environnement SINGE_DEBUG).
pub fn debug(message: &str) {
    if std::env::var_os("SINGE_DEBUG").is_some() {
        eprintln!("[singe] {message}");
    }
}

/// Verrou sur l'état partagé.
pub fn pet(app: &AppHandle) -> std::sync::MutexGuard<'_, Pet> {
    app.state::<PetState>().inner().lock().unwrap()
}

/// Verrou sur le suivi des fenêtres.
pub fn tracker(app: &AppHandle) -> std::sync::MutexGuard<'_, Tracker> {
    app.state::<TrackerState>().inner().lock().unwrap()
}

// -----------------------------------------------------------------------------
//  Écrans
// -----------------------------------------------------------------------------
pub fn displays(app: &AppHandle) -> Vec<Display> {
    app.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|m| {
            let p = m.position();
            let s = m.size();
            let wa = m.work_area();
            Display {
                id: m
                    .name()
                    .cloned()
                    .unwrap_or_else(|| format!("{},{}", p.x, p.y)),
                x: p.x,
                y: p.y,
                w: s.width as i32,
                h: s.height as i32,
                work: (
                    wa.position.x,
                    wa.position.y,
                    wa.size.width as i32,
                    wa.size.height as i32,
                ),
                scale: m.scale_factor(),
            }
        })
        .collect()
}

fn display_at(app: &AppHandle, x: f64, y: f64) -> Option<Display> {
    displays(app).into_iter().find(|d| d.contains(x, y))
}

fn signature(all: &[Display]) -> String {
    all.iter()
        .map(|d| format!("{d:?}"))
        .collect::<Vec<_>>()
        .join("|")
}

#[derive(Serialize)]
struct Range {
    top: f64,
    bottom: f64,
}

/// Infos d'écran envoyées à la page (voir world.js).
pub fn world_for(all: &[Display], d: &Display) -> Value {
    let s = d.scale;
    let (mut left, mut right) = (Vec::new(), Vec::new());
    for o in all.iter().filter(|o| o.id != d.id) {
        let top = (o.y.max(d.y) - d.y) as f64 / s;
        let bottom = ((o.y + o.h).min(d.y + d.h) - d.y) as f64 / s;
        if bottom - top < 50.0 {
            continue;
        }
        if (o.x + o.w - d.x).abs() <= 2 {
            left.push(Range { top, bottom });
        }
        if (d.x + d.w - o.x).abs() <= 2 {
            right.push(Range { top, bottom });
        }
    }
    let (wx, wy, ww, wh) = d.work;
    json!({
        "displayId": d.id,
        "origin": { "x": d.x, "y": d.y },
        "scale": s,
        "size": { "width": d.w as f64 / s, "height": d.h as f64 / s },
        "workArea": {
            "x": (wx - d.x) as f64 / s,
            "y": (wy - d.y) as f64 / s,
            "width": ww as f64 / s,
            "height": wh as f64 / s,
        },
        "neighbors": { "left": left, "right": right },
    })
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

fn place(win: &WebviewWindow, d: &Display) {
    let _ = win.set_position(PhysicalPosition::new(d.x, d.y));
    let _ = win.set_size(PhysicalSize::new(d.w as u32, d.h as u32));
    // Entre deux écrans de DPI différents, Windows peut redimensionner la
    // fenêtre après coup : on vérifie un peu plus tard.
    let (win, d) = (win.clone(), d.clone());
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(150));
        let pos = win.outer_position().ok();
        let size = win.inner_size().ok();
        if pos != Some(PhysicalPosition::new(d.x, d.y))
            || size != Some(PhysicalSize::new(d.w as u32, d.h as u32))
        {
            let _ = win.set_position(PhysicalPosition::new(d.x, d.y));
            let _ = win.set_size(PhysicalSize::new(d.w as u32, d.h as u32));
        }
    });
}

/// Déplace la fenêtre du singe sur un autre écran.
pub fn move_to_display(app: &AppHandle, d: Display) {
    let all = displays(app);
    let state = app.state::<PetState>();
    let (settings, path) = {
        let mut s = state.lock().unwrap();
        s.display = d.clone();
        s.settings.last_display = Some(d.id.clone());
        s.last_ledges.clear();
        s.last_track.clear();
        s.last_cursor = None;
        s.displays_sig = signature(&all);
        (s.settings.clone(), s.settings_path())
    };
    settings.save(&path);
    if let Some(win) = window(app) {
        place(&win, &d);
    }
    let _ = app.emit("pet:world", world_for(&all, &d));
}

/// "Rappeler le singe ici" : il réapparaît près du curseur.
pub fn recall(app: &AppHandle) {
    let Ok(pos) = app.cursor_position() else {
        return;
    };
    let current = pet(app).display.clone();
    let d = display_at(app, pos.x, pos.y).unwrap_or(current.clone());
    if d.id != current.id {
        move_to_display(app, d.clone());
    }
    let (x, y) = d.to_local(pos.x, pos.y);
    let _ = app.emit("pet:command", json!({ "type": "recall", "x": x, "y": y }));
}

/// Cache la fenêtre (appli plein écran, session verrouillée) ou la réaffiche.
pub fn set_hidden(app: &AppHandle, hidden: bool) {
    {
        let mut s = pet(app);
        if s.hidden == hidden {
            return;
        }
        s.hidden = hidden;
        s.ignoring = true;
    }
    if let Some(win) = window(app) {
        if hidden {
            let _ = win.hide();
        } else {
            let _ = win.set_ignore_cursor_events(true);
            let _ = win.show();
        }
    }
    let _ = app.emit("pet:visibility", !hidden);
}

// -----------------------------------------------------------------------------
//  Démarrage
// -----------------------------------------------------------------------------
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let data_dir = app.path().app_data_dir()?;
    let settings = Settings::load(&data_dir.join("settings.json"));

    let all = displays(app);
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|m| m.name().cloned());
    let display = all
        .iter()
        .find(|d| Some(&d.id) == settings.last_display.as_ref())
        .or_else(|| all.iter().find(|d| Some(&d.id) == primary.as_ref()))
        .or_else(|| all.first())
        .cloned()
        .unwrap_or(Display {
            id: "default".into(),
            x: 0,
            y: 0,
            w: 1920,
            h: 1080,
            work: (0, 0, 1920, 1040),
            scale: 1.0,
        });

    app.manage::<TrackerState>(Mutex::new(Tracker::new()));
    app.manage::<PetState>(Mutex::new(Pet {
        settings,
        data_dir,
        display: display.clone(),
        own: 0,
        ready: false,
        ignoring: true,
        dragging: false,
        tracked: None,
        hidden: false,
        last_ledges: String::new(),
        last_track: String::new(),
        last_cursor: None,
        cursor_inside: false,
        displays_sig: signature(&all),
    }));

    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Singe de bureau")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focusable(false) // cliquer sur le singe ne vole pas le focus de vos applis
        .focused(false)
        .visible(false)
        .build()?;
    place(&win, &display);

    // Notre propre fenêtre, à ignorer dans la liste des fenêtres
    #[cfg(windows)]
    let own = win.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    #[cfg(not(windows))]
    let own = 0;
    pet(app).own = own;
    tracker(app).set_own(own);
    system::hide_from_alt_tab(own);
    let _ = win.show();
    // Après show() : sous Linux la fenêtre doit exister pour laisser passer les clics.
    let _ = win.set_ignore_cursor_events(true);
    // Mode développeur (npm run dev) : console JavaScript (objet `pet`).
    #[cfg(debug_assertions)]
    if !crate::selftest::enabled() {
        win.open_devtools();
    }

    let handle = app.clone();
    std::thread::spawn(move || cursor_loop(handle));
    let handle = app.clone();
    std::thread::spawn(move || watch_loop(handle));
    Ok(())
}

// -----------------------------------------------------------------------------
//  Position du curseur (~60 fois/s, seulement quand elle change)
// -----------------------------------------------------------------------------
fn cursor_loop(app: AppHandle) {
    loop {
        std::thread::sleep(CURSOR_EVERY);
        let Ok(pos) = app.cursor_position() else {
            continue;
        };
        let key = (pos.x.round() as i32, pos.y.round() as i32);
        let (payload, hop) = {
            let mut s = pet(&app);
            if !s.ready || s.hidden || s.last_cursor == Some(key) {
                continue;
            }
            s.last_cursor = Some(key);
            let inside = s.display.contains(pos.x, pos.y);
            let was_inside = s.cursor_inside;
            s.cursor_inside = inside;
            let (x, y) = s.display.to_local(pos.x, pos.y);
            let payload =
                (inside || was_inside).then(|| json!({ "x": x, "y": y, "inside": inside }));
            // Pendant un glisser, la fenêtre suit le curseur sur l'écran voisin.
            (payload, s.dragging && !inside)
        };
        if hop {
            if let Some(d) = display_at(&app, pos.x, pos.y) {
                move_to_display(&app, d);
                continue;
            }
        }
        if let Some(p) = payload {
            let _ = app.emit_to(LABEL, "pet:cursor", p);
        }
    }
}

// -----------------------------------------------------------------------------
//  Surveillance périodique
// -----------------------------------------------------------------------------
fn watch_loop(app: AppHandle) {
    let mut tick: u32 = 0;
    loop {
        std::thread::sleep(TICK);
        tick = tick.wrapping_add(1);
        let (ready, hidden, dragging, own) = {
            let s = pet(&app);
            (s.ready, s.hidden, s.dragging, s.own)
        };
        if !ready {
            continue;
        }
        poll_tracked_window(&app);
        if tick.is_multiple_of(SCAN_EVERY) {
            scan_windows(&app);
        }
        if tick.is_multiple_of(TOPMOST_EVERY) && !hidden && !dragging {
            system::bring_to_top(own);
        }
        if tick.is_multiple_of(IDLE_EVERY) {
            let _ = app.emit("pet:user-idle", system::user_idle_seconds());
        }
        if tick.is_multiple_of(DISPLAYS_EVERY) {
            check_displays(&app);
        }
    }
}

// Écran branché, débranché, changement de résolution ou de barre des tâches.
fn check_displays(app: &AppHandle) {
    let all = displays(app);
    let sig = signature(&all);
    let current = {
        let s = pet(app);
        if s.displays_sig == sig {
            return;
        }
        s.display.clone()
    };
    let d = all
        .iter()
        .find(|d| d.id == current.id)
        .or_else(|| all.first())
        .cloned()
        .unwrap_or(current);
    move_to_display(app, d);
}

fn scan_windows(app: &AppHandle) {
    let (settings, d, dragging) = {
        let s = pet(app);
        (s.settings.clone(), s.display.clone(), s.dragging)
    };
    let tracker = app.state::<TrackerState>();

    // Session verrouillée, ou une appli occupe tout l'écran du singe (vidéo,
    // jeu...) : il se cache (et ne consomme plus rien).
    let full = settings.hide_on_fullscreen
        && !dragging
        && tracker.lock().unwrap().foreground_rect().is_some_and(|r| {
            r.left <= d.x + 1
                && r.top <= d.y + 1
                && r.right >= d.x + d.w - 1
                && r.bottom >= d.y + d.h - 1
        });
    set_hidden(app, full || system::session_locked());
    if !Tracker::available() || !settings.climb_windows {
        return;
    }

    let list = tracker.lock().unwrap().scan();
    let (width, height) = (d.w as f64 / d.scale, d.h as f64 / d.scale);
    let mut ledges = Vec::new();
    for l in system::ledges_from(&list) {
        let (left, y) = d.to_local(l.left as f64, l.y as f64);
        let (right, _) = d.to_local(l.right as f64, l.y as f64);
        if y < 0.0 || y > height {
            continue;
        }
        let segs: Vec<[f64; 2]> = l
            .segs
            .iter()
            .map(|&(a, b)| {
                let (a, _) = d.to_local(a as f64, 0.0);
                let (b, _) = d.to_local(b as f64, 0.0);
                [a.max(0.0).round(), b.min(width).round()]
            })
            .filter(|[a, b]| b - a >= 30.0)
            .collect();
        if !segs.is_empty() {
            ledges.push(json!({ "id": l.id, "left": left.round(), "right": right.round(), "y": y.round(), "segs": segs }));
        }
    }
    let text = serde_json::to_string(&ledges).unwrap_or_default();
    {
        let mut s = pet(app);
        if s.last_ledges == text {
            return;
        }
        s.last_ledges = text;
    }
    let _ = app.emit("pet:ledges", ledges);
}

fn poll_tracked_window(app: &AppHandle) {
    let (id, d) = {
        let s = pet(app);
        match (&s.tracked, s.hidden) {
            (Some(id), false) => (id.clone(), s.display.clone()),
            _ => return,
        }
    };
    let rect = tracker(app).poll(&id);
    let msg = match rect {
        None => json!({ "id": id, "gone": true }),
        Some(r) => {
            let (left, y) = d.to_local(r.left as f64, r.top as f64);
            let (right, _) = d.to_local(r.right as f64, r.top as f64);
            json!({ "id": id, "left": left.round(), "right": right.round(), "y": y.round() })
        }
    };
    let text = msg.to_string();
    {
        let mut s = pet(app);
        if s.last_track == text {
            return;
        }
        s.last_track = text;
    }
    let _ = app.emit("pet:ledge-move", msg);
}

// -----------------------------------------------------------------------------
//  Commandes appelées par la page (voir src/renderer/platform.js)
// -----------------------------------------------------------------------------
#[tauri::command]
pub fn pet_ready(app: AppHandle) -> Value {
    let all = displays(&app);
    let (settings, display, data_dir) = {
        let mut s = pet(&app);
        s.ready = true;
        s.ignoring = true;
        s.dragging = false;
        s.last_ledges.clear();
        s.last_track.clear();
        s.last_cursor = None;
        (s.settings.clone(), s.display.clone(), s.data_dir.clone())
    };
    // Réglages personnels facultatifs (fusionnés dans config.js par la page)
    let user_config = std::fs::read_to_string(data_dir.join("config.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .unwrap_or(Value::Null);
    json!({
        "settings": settings,
        "world": world_for(&all, &display),
        "hasUserModel": data_dir.join("monkey.glb").is_file(),
        // assets/models/monkey.glb du projet, intégré à l'exécutable
        "hasBundledModel": app.asset_resolver().get("models/monkey.glb".into()).is_some(),
        "userConfig": user_config,
        "debug": cfg!(debug_assertions) || std::env::var_os("SINGE_DEBUG").is_some(),
        "selftest": crate::selftest::enabled(),
    })
}

#[tauri::command]
pub fn set_ignore_mouse(app: AppHandle, ignore: bool) {
    debug(&format!("clics traversants : {ignore}"));
    pet(&app).ignoring = ignore;
    if let Some(win) = window(&app) {
        let _ = win.set_ignore_cursor_events(ignore);
    }
}

#[tauri::command]
pub fn set_dragging(app: AppHandle, dragging: bool) {
    pet(&app).dragging = dragging;
}

/// Le singe veut aller sur l'écran qui contient ce point (coordonnées de la page).
#[tauri::command]
pub fn move_to_display_at(app: AppHandle, x: f64, y: f64) {
    if !x.is_finite() || !y.is_finite() {
        return;
    }
    let current = pet(&app).display.clone();
    let (gx, gy) = current.to_global(x, y);
    if let Some(d) = display_at(&app, gx, gy) {
        if d.id != current.id {
            move_to_display(&app, d);
        }
    }
}

#[tauri::command]
pub fn track_window(app: AppHandle, id: Option<String>) {
    let mut s = pet(&app);
    s.tracked = id;
    s.last_track.clear();
}

#[tauri::command]
pub fn show_menu(app: AppHandle) {
    let menu = crate::tray::current_menu(&app);
    if let (Some(win), Some(menu)) = (window(&app), menu) {
        let _ = win.popup_menu(&menu);
    }
}

#[tauri::command]
pub fn prank(app: AppHandle, prank: crate::pranks::Prank) {
    crate::pranks::run(&app, prank);
}

#[tauri::command]
pub fn selftest_report(app: AppHandle, report: Value) {
    crate::selftest::on_report(&app, report);
}

/// Sert le modèle personnalisé `monkey.glb` du dossier de données.
pub fn serve_model(app: &AppHandle) -> tauri::http::Response<Vec<u8>> {
    let bytes = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|d| std::fs::read(d.join("monkey.glb")).ok());
    let builder = tauri::http::Response::builder().header("Access-Control-Allow-Origin", "*");
    match bytes {
        Some(b) => builder.header("Content-Type", "model/gltf-binary").body(b),
        None => builder.status(404).body(Vec::new()),
    }
    .expect("réponse HTTP valide")
}
