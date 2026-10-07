//! Accès au système d'exploitation.
//!
//! Sous Windows : liste des fenêtres ouvertes (pour que le singe grimpe sur
//! leur bord supérieur), application en plein écran, déplacement d'une
//! fenêtre (bêtise), temps d'inactivité de l'utilisateur.
//! Ailleurs : versions "vides" (ces bonus sont simplement désactivés).
//!
//! Toutes les coordonnées sont en pixels PHYSIQUES du bureau.

use serde::Serialize;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

/// Une fenêtre visible (de la plus en avant à la plus en arrière).
pub struct WinInfo {
    pub id: String,
    pub rect: Rect,
    /// "Vraie" fenêtre d'application sur laquelle le singe peut monter.
    pub ledge: bool,
}

/// Bord supérieur d'une fenêtre, découpé en morceaux visibles.
pub struct Ledge {
    pub id: String,
    pub left: i32,
    pub right: i32,
    pub y: i32,
    pub segs: Vec<(i32, i32)>,
}

/// Bords supérieurs visibles : on retire les morceaux cachés par les
/// fenêtres situées devant.
pub fn ledges_from(list: &[WinInfo]) -> Vec<Ledge> {
    let mut out = Vec::new();
    for (i, w) in list.iter().enumerate() {
        if !w.ledge {
            continue;
        }
        let y = w.rect.top;
        let mut segs = vec![(w.rect.left, w.rect.right)];
        for o in list[..i].iter().map(|o| o.rect) {
            if segs.is_empty() {
                break;
            }
            if o.top <= y + 2 && o.bottom >= y - 2 {
                segs = subtract(&segs, o.left, o.right);
            }
        }
        segs.retain(|(a, b)| b - a >= 40);
        if !segs.is_empty() {
            out.push(Ledge {
                id: w.id.clone(),
                left: w.rect.left,
                right: w.rect.right,
                y,
                segs,
            });
        }
    }
    out
}

fn subtract(segs: &[(i32, i32)], a: i32, b: i32) -> Vec<(i32, i32)> {
    let mut out = Vec::new();
    for &(x1, x2) in segs {
        if b <= x1 || a >= x2 {
            out.push((x1, x2));
        } else {
            if a > x1 {
                out.push((x1, a));
            }
            if b < x2 {
                out.push((b, x2));
            }
        }
    }
    out
}

#[cfg(windows)]
pub use win::*;

#[cfg(not(windows))]
pub use other::*;

// =============================================================================
//  Windows
// =============================================================================
#[cfg(windows)]
mod win {
    use super::{Rect, WinInfo};
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::Graphics::Dwm::{
        DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS,
    };
    use windows::Win32::System::StationsAndDesktops::{
        CloseDesktop, OpenInputDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_SWITCHDESKTOP,
    };
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetForegroundWindow, GetWindowLongW, GetWindowRect,
        GetWindowTextLengthW, IsIconic, IsWindow, IsWindowVisible, IsZoomed, SetWindowLongW,
        SetWindowPos, GWL_EXSTYLE, GWL_STYLE, HWND_TOPMOST, STYLESTRUCT, SWP_ASYNCWINDOWPOS,
        SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER, WM_STYLECHANGING,
        WS_CAPTION, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    /// Bureau (fond d'écran) : jamais un rebord, jamais une appli plein écran.
    const DESKTOP: &[&str] = &["Progman", "WorkerW"];
    /// Éléments du shell Windows (barre des tâches, menus, notifications...).
    const SHELL: &[&str] = &[
        "Shell_TrayWnd",
        "Shell_SecondaryTrayWnd",
        "NotifyIconOverflowWindow",
        "Windows.UI.Core.CoreWindow",
        "XamlExplorerHostIslandWindow",
        "TopLevelWindowForOverflowXamlIsland",
        "ForegroundStaging",
    ];

    fn hwnd(id: isize) -> HWND {
        HWND(id as *mut core::ffi::c_void)
    }

    pub struct Tracker {
        own: isize,
        by_id: HashMap<String, isize>,
        ledge_ids: HashSet<String>,
        classes: HashMap<String, String>,
        /// Numéro du déplacement en cours (un nouveau déplacement annule l'ancien).
        moving: Arc<AtomicU64>,
    }

    impl Tracker {
        pub fn new() -> Self {
            Self {
                own: 0,
                by_id: HashMap::new(),
                ledge_ids: HashSet::new(),
                classes: HashMap::new(),
                moving: Arc::new(AtomicU64::new(0)),
            }
        }

        pub fn available() -> bool {
            true
        }

        /// Notre propre fenêtre (à ignorer).
        pub fn set_own(&mut self, own: isize) {
            self.own = own;
        }

        /// Énumère les fenêtres visibles, de la plus en avant à la plus en arrière.
        pub fn scan(&mut self) -> Vec<WinInfo> {
            unsafe extern "system" fn collect(h: HWND, lp: LPARAM) -> BOOL {
                let list = unsafe { &mut *(lp.0 as *mut Vec<isize>) };
                list.push(h.0 as isize);
                BOOL(1)
            }
            let mut raw: Vec<isize> = Vec::with_capacity(256);
            unsafe {
                let _ = EnumWindows(Some(collect), LPARAM(&mut raw as *mut Vec<isize> as isize));
            }
            self.by_id.clear();
            self.ledge_ids.clear();
            self.classes.clear();
            let mut list = Vec::new();
            for id in raw {
                if let Some((info, class)) = self.inspect(id) {
                    self.by_id.insert(info.id.clone(), id);
                    if info.ledge {
                        self.ledge_ids.insert(info.id.clone());
                    }
                    self.classes.insert(info.id.clone(), class);
                    list.push(info);
                }
            }
            list
        }

        fn inspect(&self, id: isize) -> Option<(WinInfo, String)> {
            if id == self.own {
                return None;
            }
            let h = hwnd(id);
            unsafe {
                if !IsWindowVisible(h).as_bool() || IsIconic(h).as_bool() {
                    return None;
                }
                let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32;
                if ex & WS_EX_TRANSPARENT.0 != 0 || is_cloaked(h) {
                    return None; // fenêtre "fantôme", autre bureau virtuel, appli suspendue
                }
                let r = frame_rect(h)?;
                let (w, height) = (r.right - r.left, r.bottom - r.top);
                if w < 40 || height < 20 {
                    return None;
                }
                let class = class_name(h);
                if DESKTOP.contains(&class.as_str()) {
                    return None;
                }
                let tool = ex & WS_EX_TOOLWINDOW.0 != 0 && ex & WS_EX_APPWINDOW.0 == 0;
                let ledge = !tool
                    && !SHELL.contains(&class.as_str())
                    && w >= 150
                    && height >= 80
                    && GetWindowTextLengthW(h) > 0;
                Some((
                    WinInfo {
                        id: format!("{id:x}"),
                        rect: r,
                        ledge,
                    },
                    class,
                ))
            }
        }

        /// Position actuelle d'une fenêtre (None si fermée / réduite / cachée).
        pub fn poll(&self, id: &str) -> Option<Rect> {
            let h = hwnd(*self.by_id.get(id)?);
            unsafe {
                if !IsWindow(Some(h)).as_bool()
                    || !IsWindowVisible(h).as_bool()
                    || IsIconic(h).as_bool()
                    || is_cloaked(h)
                {
                    return None;
                }
                frame_rect(h)
            }
        }

        /// Rectangle de la fenêtre au premier plan si elle PEUT être en plein
        /// écran (pas le bureau, pas une fenêtre simplement agrandie avec sa
        /// barre de titre).
        pub fn foreground_rect(&self) -> Option<Rect> {
            unsafe {
                let fg = GetForegroundWindow();
                if fg.0.is_null() || fg.0 as isize == self.own {
                    return None;
                }
                let class = class_name(fg);
                if DESKTOP.contains(&class.as_str()) || SHELL.contains(&class.as_str()) {
                    return None;
                }
                let style = GetWindowLongW(fg, GWL_STYLE) as u32;
                if IsZoomed(fg).as_bool() && style & WS_CAPTION.0 == WS_CAPTION.0 {
                    return None;
                }
                let mut r = RECT::default();
                GetWindowRect(fg, &mut r).ok()?;
                Some(Rect {
                    left: r.left,
                    top: r.top,
                    right: r.right,
                    bottom: r.bottom,
                })
            }
        }

        /// Bêtise : fait glisser une fenêtre de (dx, dy) pixels en `ms`
        /// millisecondes, avec un petit tremblement au départ, sans l'activer
        /// ni la redimensionner. Seulement une "vraie" fenêtre d'application
        /// repérée au dernier balayage, jamais une fenêtre agrandie ou réduite.
        pub fn move_by(&self, id: &str, dx: i32, dy: i32, ms: u64) -> bool {
            let Some(&raw) = self.by_id.get(id) else {
                return false;
            };
            if !self.ledge_ids.contains(id) {
                return false;
            }
            let h = hwnd(raw);
            let mut r = RECT::default();
            unsafe {
                if !IsWindow(Some(h)).as_bool() || IsIconic(h).as_bool() || IsZoomed(h).as_bool() {
                    return false;
                }
                if GetWindowRect(h, &mut r).is_err() {
                    return false;
                }
            }
            let generation = self.moving.fetch_add(1, Ordering::SeqCst) + 1;
            let moving = Arc::clone(&self.moving);
            let (x0, y0) = (r.left as f64, r.top as f64);
            std::thread::spawn(move || {
                let start = Instant::now();
                let flags = SWP_NOSIZE
                    | SWP_NOZORDER
                    | SWP_NOACTIVATE
                    | SWP_NOOWNERZORDER
                    | SWP_ASYNCWINDOWPOS;
                loop {
                    if moving.load(Ordering::SeqCst) != generation {
                        break; // un autre déplacement a pris le relais
                    }
                    let t = (start.elapsed().as_secs_f64() * 1000.0 / ms.max(1) as f64).min(1.0);
                    // accélère puis freine
                    let e = if t < 0.5 {
                        2.0 * t * t
                    } else {
                        1.0 - (-2.0 * t + 2.0).powi(2) / 2.0
                    };
                    // il prend son élan : petit tremblement
                    let shake = if t < 0.25 {
                        (t * 90.0).sin() * 6.0 * (1.0 - t / 0.25)
                    } else {
                        0.0
                    };
                    let x = (x0 + dx as f64 * e + shake).round() as i32;
                    let y = (y0 + dy as f64 * e).round() as i32;
                    let h = hwnd(raw);
                    if unsafe { SetWindowPos(h, None, x, y, 0, 0, flags) }.is_err() || t >= 1.0 {
                        break; // fini, ou fenêtre fermée entre-temps
                    }
                    std::thread::sleep(Duration::from_millis(16));
                }
            });
            true
        }

        /// Identifiant d'une fenêtre de la classe donnée (auto-test).
        pub fn find_by_class(&self, class: &str) -> Option<String> {
            self.classes
                .iter()
                .find(|(_, c)| c.as_str() == class)
                .map(|(id, _)| id.clone())
        }
    }

    /// Repasse notre fenêtre au-dessus des autres fenêtres "toujours visibles".
    pub fn bring_to_top(own: isize) {
        if own == 0 {
            return;
        }
        unsafe {
            let _ = SetWindowPos(
                hwnd(own),
                Some(HWND_TOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS,
            );
        }
    }

    /// Retire notre fenêtre de la liste Alt+Tab (style "fenêtre outil").
    /// Tao réécrit les styles étendus à chaque bascule des clics traversants :
    /// on intercepte donc chaque changement de style pour y remettre ce bit.
    /// À appeler depuis le fil principal (celui qui a créé la fenêtre).
    pub fn hide_from_alt_tab(own: isize) {
        unsafe extern "system" fn keep_tool_window(
            h: HWND,
            msg: u32,
            wp: WPARAM,
            lp: LPARAM,
            _id: usize,
            _data: usize,
        ) -> LRESULT {
            if msg == WM_STYLECHANGING && wp.0 as i32 == GWL_EXSTYLE.0 {
                let change = unsafe { &mut *(lp.0 as *mut STYLESTRUCT) };
                change.styleNew = (change.styleNew | WS_EX_TOOLWINDOW.0) & !WS_EX_APPWINDOW.0;
            }
            unsafe { DefSubclassProc(h, msg, wp, lp) }
        }
        if own == 0 {
            return;
        }
        let h = hwnd(own);
        unsafe {
            let _ = SetWindowSubclass(h, Some(keep_tool_window), 0x5149_4E47, 0);
            let ex = GetWindowLongW(h, GWL_EXSTYLE);
            SetWindowLongW(h, GWL_EXSTYLE, ex | WS_EX_TOOLWINDOW.0 as i32);
        }
    }

    /// Notre fenêtre est-elle bien absente d'Alt+Tab ? (auto-test)
    pub fn hidden_from_alt_tab(own: isize) -> Option<bool> {
        let ex = unsafe { GetWindowLongW(hwnd(own), GWL_EXSTYLE) } as u32;
        Some(ex & WS_EX_TOOLWINDOW.0 != 0 && ex & WS_EX_APPWINDOW.0 == 0)
    }

    /// Secondes depuis la dernière action au clavier ou à la souris.
    pub fn user_idle_seconds() -> u64 {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        unsafe {
            if !GetLastInputInfo(&mut info).as_bool() {
                return 0;
            }
            (GetTickCount().wrapping_sub(info.dwTime) / 1000) as u64
        }
    }

    /// Session verrouillée (Win+L, écran de connexion) ou bureau sécurisé (UAC) :
    /// le bureau qui reçoit le clavier et la souris n'est alors plus le nôtre.
    pub fn session_locked() -> bool {
        unsafe {
            match OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_SWITCHDESKTOP) {
                Ok(desk) => {
                    let _ = CloseDesktop(desk);
                    false
                }
                Err(_) => true,
            }
        }
    }

    // Bords visibles (sans les bordures invisibles de redimensionnement de Windows 10/11).
    unsafe fn frame_rect(h: HWND) -> Option<Rect> {
        let mut r = RECT::default();
        let size = std::mem::size_of::<RECT>() as u32;
        let ok = unsafe {
            DwmGetWindowAttribute(
                h,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut r as *mut RECT as *mut _,
                size,
            )
            .is_ok()
                || GetWindowRect(h, &mut r).is_ok()
        };
        ok.then_some(Rect {
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
        })
    }

    unsafe fn is_cloaked(h: HWND) -> bool {
        let mut cloaked: u32 = 0;
        unsafe {
            DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, 4).is_ok()
                && cloaked != 0
        }
    }

    unsafe fn class_name(h: HWND) -> String {
        let mut buf = [0u16; 256];
        let n = unsafe { GetClassNameW(h, &mut buf) };
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }
}

// =============================================================================
//  Autres systèmes : pas de suivi des fenêtres
// =============================================================================
#[cfg(not(windows))]
mod other {
    use super::{Rect, WinInfo};

    pub struct Tracker;

    impl Tracker {
        pub fn new() -> Self {
            Tracker
        }
        pub fn available() -> bool {
            false
        }
        pub fn set_own(&mut self, _own: isize) {}
        pub fn scan(&mut self) -> Vec<WinInfo> {
            Vec::new()
        }
        pub fn poll(&self, _id: &str) -> Option<Rect> {
            None
        }
        pub fn foreground_rect(&self) -> Option<Rect> {
            None
        }
        pub fn move_by(&self, _id: &str, _dx: i32, _dy: i32, _ms: u64) -> bool {
            false
        }
        pub fn find_by_class(&self, _class: &str) -> Option<String> {
            None
        }
    }

    pub fn bring_to_top(_own: isize) {}

    pub fn hide_from_alt_tab(_own: isize) {}

    pub fn hidden_from_alt_tab(_own: isize) -> Option<bool> {
        None
    }

    pub fn user_idle_seconds() -> u64 {
        0
    }

    pub fn session_locked() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(id: &str, l: i32, t: i32, r: i32, b: i32, ledge: bool) -> WinInfo {
        WinInfo {
            id: id.into(),
            rect: Rect {
                left: l,
                top: t,
                right: r,
                bottom: b,
            },
            ledge,
        }
    }

    #[test]
    fn hidden_parts_of_top_edges_are_removed() {
        // B (devant) cache le milieu du bord supérieur de A
        let list = vec![
            win("B", 300, 50, 500, 400, true),
            win("A", 100, 100, 900, 600, true),
        ];
        let ledges = ledges_from(&list);
        assert_eq!(ledges.len(), 2);
        assert_eq!(ledges[0].segs, vec![(300, 500)]);
        assert_eq!(ledges[1].segs, vec![(100, 300), (500, 900)]);
    }

    #[test]
    fn tiny_segments_and_non_ledges_are_dropped() {
        let list = vec![
            win("T", 110, 0, 880, 900, false),
            win("A", 100, 100, 900, 600, true),
        ];
        let ledges = ledges_from(&list);
        assert!(
            ledges.is_empty(),
            "il ne reste que 10 et 20 px de bord visibles"
        );
    }
}
