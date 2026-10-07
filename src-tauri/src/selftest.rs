//! Auto-test pour l'intégration continue : `SINGE_SELFTEST=rapport.json`.
//!
//! La page joue un petit scénario (voir src/renderer/selftest.js) puis nous
//! envoie son rapport. On teste ensuite ce qui ne peut l'être que "en vrai" :
//! survol du singe par le vrai curseur (bascule des clics traversants), liste
//! des fenêtres, déplacement d'une fenêtre (classe `SINGE_SELFTEST_MOVE_CLASS`,
//! ex. Notepad), écriture d'une note. Puis on écrit le rapport et on quitte.

use crate::overlay::{self, TrackerState};
use crate::system::{self, Tracker};
use serde_json::{json, Map, Value};
use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition};

pub fn enabled() -> bool {
    std::env::var_os("SINGE_SELFTEST").is_some()
}

/// Sécurité : si la page ne répond pas, on écrit quand même un rapport.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(120));
        write_report(&json!({ "error": "délai dépassé : la page n'a pas envoyé de rapport" }));
        app.exit(2);
    });
}

pub fn on_report(app: &AppHandle, renderer: Value) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut r = Map::new();
        let sleep = |ms| std::thread::sleep(Duration::from_millis(ms));
        let ignoring = |app: &AppHandle| overlay::pet(app).ignoring;

        let all = overlay::displays(&app);
        r.insert(
            "displays".into(),
            json!(all.iter().map(|d| json!({ "id": d.id, "x": d.x, "y": d.y, "w": d.w, "h": d.h, "work": d.work, "scale": d.scale })).collect::<Vec<_>>()),
        );
        r.insert("windowTracker".into(), json!(Tracker::available()));
        let list = overlay::tracker(&app).scan();
        r.insert("windowsSeen".into(), json!(list.len()));
        r.insert("ledges".into(), json!(system::ledges_from(&list).len()));
        r.insert("userIdleSeconds".into(), json!(system::user_idle_seconds()));

        // Survol : on place le vrai curseur sur le singe, puis loin de lui.
        let target = renderer
            .pointer("/monkeyBody/global")
            .and_then(|g| Some((g["x"].as_f64()?, g["y"].as_f64()?)));
        let win = overlay::window(&app);
        if let (Some((x, y)), Some(win)) = (target, win) {
            let before = ignoring(&app);
            let d = overlay::pet(&app).display.clone();
            let at = |gx: f64, gy: f64| {
                win.set_cursor_position(PhysicalPosition::new(gx - d.x as f64, gy - d.y as f64))
            };
            if at(x, y).is_ok() {
                sleep(1000);
                let over = ignoring(&app);
                let _ = at(d.x as f64 + 5.0, d.y as f64 + 5.0);
                sleep(1000);
                let away = ignoring(&app);
                r.insert(
                    "hover".into(),
                    json!({ "ignoringBefore": before, "ignoringOverMonkey": over, "ignoringAway": away }),
                );
            }
        }

        // Déplacement d'une vraie fenêtre (le test lance le Bloc-notes avant)
        if let Ok(class) = std::env::var("SINGE_SELFTEST_MOVE_CLASS") {
            let tracker = app.state::<TrackerState>();
            let found = {
                let mut t = tracker.lock().unwrap();
                t.scan();
                t.find_by_class(&class)
            };
            let result = match found {
                Some(id) => {
                    let (before, started) = {
                        let t = tracker.lock().unwrap();
                        (t.poll(&id), t.move_by(&id, 150, 60, 600))
                    };
                    sleep(1500);
                    let after = tracker.lock().unwrap().poll(&id);
                    json!({ "found": true, "started": started, "before": before, "after": after })
                }
                None => json!({ "found": false }),
            };
            r.insert("moveWindow".into(), result);
        }

        r.insert(
            "noteWritten".into(),
            json!(crate::pranks::write_note(1).is_some_and(|p| p.exists())),
        );
        r.insert("renderer".into(), renderer);
        write_report(&Value::Object(r));
        app.exit(0);
    });
}

fn write_report(report: &Value) {
    if let Some(path) = std::env::var_os("SINGE_SELFTEST") {
        let text = serde_json::to_string_pretty(report).unwrap_or_default();
        if let Err(err) = std::fs::write(&path, text) {
            eprintln!("[singe] impossible d'écrire le rapport : {err}");
        }
    }
}
