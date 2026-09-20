use objc2_app_kit::NSScreen;
use objc2_foundation::MainThreadMarker;

pub fn menu_bar_height() -> Option<f64> {
    let main_thread = MainThreadMarker::new()?;
    let screen = NSScreen::mainScreen(main_thread)?;
    let frame = screen.frame();
    let visible = screen.visibleFrame();
    let height = frame.size.height - (visible.origin.y + visible.size.height);
    if height.is_finite() && height >= 0.0 {
        Some(height)
    } else {
        None
    }
}
