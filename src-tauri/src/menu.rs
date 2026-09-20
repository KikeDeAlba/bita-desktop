use tauri::menu::{Menu, PredefinedMenuItem, Submenu};
use tauri::AppHandle;

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
            &PredefinedMenuItem::copy(app, Some("Copiar"))?,
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
        ],
    )?;

    let menu = Menu::with_items(app, &[&bita, &edit, &window])?;
    app.set_menu(menu)?;
    Ok(())
}
