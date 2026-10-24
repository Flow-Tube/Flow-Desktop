use objc2::runtime::AnyObject;
use objc2::{class, msg_send, sel};
use tauri::{AppHandle, Manager, WebviewWindow, WindowEvent};

/// WebKit's feature key for rendering pages near 60 fps on faster displays.
const NEAR_60_FPS_FEATURE: &std::ffi::CStr = c"PreferPageRenderingUpdatesNear60FPSEnabled";

pub fn install_close_handler(window: &WebviewWindow) {
    let main_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            // Keep playback, downloads, and the webview alive until explicit Quit.
            api.prevent_close();
            if let Err(error) = main_window.hide() {
                tracing::warn!(%error, "Could not hide the main window");
            }
        }
    });
}

pub fn reopen(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = window
            .unminimize()
            .and_then(|()| window.show())
            .and_then(|()| window.set_focus())
        {
            tracing::warn!(%error, "Could not reopen the main window");
        }
    }
}

/// Lets the webview render at the display's own rate. WebKit turns on "Prefer
/// Page Rendering Updates near 60fps" by default, so on a 120 Hz ProMotion
/// screen every animation, scroll and frame loop in the app ran at 60 fps.
pub fn allow_full_frame_rate<R: tauri::Runtime>(window: &WebviewWindow<R>) {
    let result = window.with_webview(|webview| {
        // SAFETY: `inner()` is the live WKWebView, and this closure runs on
        // the main thread, where AppKit objects may be used.
        let disabled = unsafe { disable_near_60_fps(webview.inner().cast()) };
        if !disabled {
            tracing::info!("frame_rate_preference_unavailable");
        }
    });
    if let Err(error) = result {
        tracing::warn!(%error, "frame_rate_preference_failed");
    }
}

/// Turns the feature off through WebKit's feature list, which is SPI: every
/// step checks the selector first, so a WebKit without it is left untouched.
unsafe fn disable_near_60_fps(view: *mut AnyObject) -> bool {
    let Some(view) = (unsafe { view.as_ref() }) else {
        return false;
    };
    let preferences_class = class!(WKPreferences);
    let lists_features: bool =
        unsafe { msg_send![preferences_class, respondsToSelector: sel!(_features)] };
    if !lists_features {
        return false;
    }
    let configuration: *mut AnyObject = unsafe { msg_send![view, configuration] };
    let Some(configuration) = (unsafe { configuration.as_ref() }) else {
        return false;
    };
    let preferences: *mut AnyObject = unsafe { msg_send![configuration, preferences] };
    let Some(preferences) = (unsafe { preferences.as_ref() }) else {
        return false;
    };
    let can_set: bool =
        unsafe { msg_send![preferences, respondsToSelector: sel!(_setEnabled:forFeature:)] };
    if !can_set {
        return false;
    }
    let wanted: *mut AnyObject =
        unsafe { msg_send![class!(NSString), stringWithUTF8String: NEAR_60_FPS_FEATURE.as_ptr()] };
    let features: *mut AnyObject = unsafe { msg_send![preferences_class, _features] };
    let Some(features) = (unsafe { features.as_ref() }) else {
        return false;
    };
    let count: usize = unsafe { msg_send![features, count] };
    for index in 0..count {
        let feature: *mut AnyObject = unsafe { msg_send![features, objectAtIndex: index] };
        let Some(feature) = (unsafe { feature.as_ref() }) else {
            continue;
        };
        let key: *mut AnyObject = unsafe { msg_send![feature, key] };
        let matches: bool = unsafe { msg_send![key, isEqualToString: wanted] };
        if matches {
            let _: () = unsafe { msg_send![preferences, _setEnabled: false, forFeature: feature] };
            return true;
        }
    }
    false
}
