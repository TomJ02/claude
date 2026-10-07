//! Singe de bureau : programme principal (Tauri).
//!
//! La page (src/renderer/) contient tout le singe : modèle 3D, animations,
//! comportements, jeu. Ce programme s'occupe de ce qui touche au système :
//! fenêtre transparente, clics traversants, écrans, icône de notification,
//! réglages, fenêtres ouvertes (Windows) et bêtises.

// Pas de console noire derrière l'application (Windows, version finale)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod overlay;
mod pranks;
mod selftest;
mod settings;
mod system;
mod tray;

fn main() {
    tauri::Builder::default()
        // Relancer l'appli alors qu'elle tourne déjà = rappeler le singe
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            overlay::recall(app)
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        // Modèle 3D personnalisé : petmodel://localhost/monkey.glb
        .register_uri_scheme_protocol("petmodel", |ctx, _request| {
            overlay::serve_model(ctx.app_handle())
        })
        .invoke_handler(tauri::generate_handler![
            overlay::pet_ready,
            overlay::set_ignore_mouse,
            overlay::set_dragging,
            overlay::move_to_display_at,
            overlay::track_window,
            overlay::show_menu,
            overlay::prank,
            overlay::selftest_report,
        ])
        .on_menu_event(|app, event| tray::on_menu_event(app, event.id().as_ref()))
        .setup(|app| {
            // macOS : pas d'icône dans le Dock, seulement dans la barre des menus
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            overlay::setup(app.handle())?;
            tray::create(app.handle())?;
            if selftest::enabled() {
                selftest::start(app.handle());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au démarrage du singe");
}
