//! The Dock icon's menu. Neither Tauri nor tao exposes one, so this adds `AppKit`'s
//! `applicationDockMenu:` to tao's application delegate and builds the menu directly.

use std::ffi::CString;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicPtr, Ordering};

use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, NSObject, Sel};
use objc2::{ClassType, class, define_class, ffi, msg_send, sel};
use tauri::AppHandle;

use crate::services::shell_pages::{self, ShellLabels};

static APP: OnceLock<AppHandle> = OnceLock::new();
static MENU: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "FlowDockMenuTarget"]
    struct DockMenuTarget;

    impl DockMenuTarget {
        #[unsafe(method(openPage:))]
        fn open_page(&self, sender: &AnyObject) {
            let tag: isize = unsafe { msg_send![sender, tag] };
            let route = usize::try_from(tag).ok().and_then(shell_pages::route_at);
            if let (Some(route), Some(app)) = (route, APP.get()) {
                shell_pages::open_route(app, route);
            }
        }
    }
);

extern "C-unwind" fn application_dock_menu(
    _delegate: *mut AnyObject,
    _selector: Sel,
    _application: *mut AnyObject,
) -> *mut AnyObject {
    MENU.load(Ordering::Acquire)
}

fn ns_string(text: &str) -> *mut AnyObject {
    let text = CString::new(text.replace('\0', "")).unwrap_or_default();
    unsafe { msg_send![class!(NSString), stringWithUTF8String: text.as_ptr()] }
}

/// Builds the menu and teaches the delegate to return it. Runs on the main thread.
pub fn install(app: &AppHandle, labels: &ShellLabels) {
    let _ = APP.set(app.clone());
    // SAFETY: AppKit calls on the main thread with objects created here. The menu and its target
    // stay alive for the whole process: menus hold their items' targets weakly, and the delegate
    // method hands the same menu back every time.
    unsafe {
        let target: Retained<DockMenuTarget> = msg_send![DockMenuTarget::class(), new];
        let target = Retained::into_raw(target);
        let menu: *mut AnyObject = msg_send![class!(NSMenu), new];
        let _: () = msg_send![menu, setAutoenablesItems: Bool::NO];
        for (tag, (_, label)) in labels.entries().into_iter().enumerate() {
            let item: *mut AnyObject = msg_send![
                menu,
                addItemWithTitle: ns_string(label),
                action: sel!(openPage:),
                keyEquivalent: ns_string("")
            ];
            let _: () = msg_send![item, setTag: tag.cast_signed()];
            let _: () = msg_send![item, setTarget: target.cast::<AnyObject>()];
        }
        let previous = MENU.swap(menu, Ordering::AcqRel);
        if !previous.is_null() {
            return;
        }

        let application: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let delegate: *mut AnyObject = msg_send![application, delegate];
        let Some(delegate) = delegate.as_ref() else {
            tracing::warn!("No application delegate for the Dock menu");
            return;
        };
        let added = ffi::class_addMethod(
            std::ptr::from_ref::<AnyClass>(delegate.class()).cast_mut(),
            sel!(applicationDockMenu:),
            std::mem::transmute::<
                extern "C-unwind" fn(*mut AnyObject, Sel, *mut AnyObject) -> *mut AnyObject,
                objc2::runtime::Imp,
            >(application_dock_menu),
            c"@@:@".as_ptr(),
        );
        if !added.as_bool() {
            tracing::warn!("Could not add the Dock menu to the application delegate");
        }
    }
}
