mod panel;
mod tray;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .setup(|app| {
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            tray::create(app.handle())?;
            panel::wire(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start bita-desktop");
}
