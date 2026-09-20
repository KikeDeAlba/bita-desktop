#[cfg(target_os = "macos")]
pub fn write(text: &str) -> bool {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::NSString;

    unsafe {
        let pasteboard = NSPasteboard::generalPasteboard();
        pasteboard.clearContents();
        pasteboard.setString_forType(&NSString::from_str(text), NSPasteboardTypeString)
    }
}

#[cfg(not(target_os = "macos"))]
pub fn write(_text: &str) -> bool {
    false
}
