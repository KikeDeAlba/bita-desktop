#[cfg(target_os = "macos")]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::AppHandle;

pub const LIVE: &str = "live-assist";
pub const LIVE_WIDE: &str = "live-wide";

#[cfg(not(target_os = "macos"))]
pub fn create(_app: &AppHandle) -> tauri::Result<()> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let bita = Submenu::with_items(
        app,
        "bita",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("Acerca de bita"), None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Ocultar bita"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Salir de bita"))?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "Edición",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("Deshacer"))?,
            &PredefinedMenuItem::redo(app, Some("Rehacer"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Cortar"))?,
            &PredefinedMenuItem::copy(app, Some("Copiar"))?,
            &PredefinedMenuItem::paste(app, Some("Pegar"))?,
            &PredefinedMenuItem::select_all(app, Some("Seleccionar todo"))?,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        "Ventana",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Minimizar"))?,
            &PredefinedMenuItem::close_window(app, Some("Cerrar"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, LIVE, "Asistente de reunión", true, None::<&str>)?,
            &MenuItem::with_id(app, LIVE_WIDE, "Ventana amplia", true, None::<&str>)?,
        ],
    )?;

    let menu = Menu::with_items(app, &[&bita, &edit, &window])?;
    app.set_menu(menu)?;
    Ok(())
}
