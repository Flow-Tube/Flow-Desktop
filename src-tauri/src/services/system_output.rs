//! Whether the computer's own sound output is muted or turned all the way down. Flow for Android
//! pauses music when the phone's media volume is muted; the match here is the system output, which
//! Flow's own volume slider never sees.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

/// Sent with `true` while the system output is silent, `false` once it plays again.
pub const SILENT_EVENT: &str = "flow:system-output-silent";

// Neither CoreAudio nor Core Audio on Windows can be asked to call back from a plain thread
// without a run loop or a COM sink, so the output is read on a short timer instead.
const POLL: Duration = Duration::from_millis(400);

/// Stops the running watch; nothing runs while the setting is off.
#[derive(Default)]
pub struct SystemOutputWatch(Mutex<Option<Arc<AtomicBool>>>);

/// Whether this desktop can report its output volume.
pub fn supported() -> bool {
    cfg!(any(target_os = "macos", windows))
}

/// Starts or stops reporting the system output's silence to the windows.
pub fn set_watching(app: &AppHandle, enabled: bool) {
    let state = app.state::<SystemOutputWatch>();
    let mut running = state.0.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(stop) = running.take() {
        stop.store(true, Ordering::Relaxed);
    }
    if !enabled || !supported() {
        return;
    }
    let stop = Arc::new(AtomicBool::new(false));
    *running = Some(Arc::clone(&stop));
    let handle = app.clone();
    let spawned = std::thread::Builder::new()
        .name("system-output".into())
        .spawn(move || watch(&handle, &stop));
    if let Err(error) = spawned {
        tracing::warn!(%error, "Failed to start the system output watch");
    }
}

fn watch(app: &AppHandle, stop: &AtomicBool) {
    let Some(mut output) = platform::Output::open() else {
        return;
    };
    let mut last = None;
    while !stop.load(Ordering::Relaxed) {
        let silent = output.silent().unwrap_or(false);
        if last != Some(silent) {
            last = Some(silent);
            if let Err(error) = app.emit(SILENT_EVENT, silent) {
                tracing::warn!(%error, "Could not report the system output");
            }
        }
        std::thread::sleep(POLL);
    }
}

/// A volume this low is heard as nothing.
#[cfg(any(target_os = "macos", windows))]
const SILENT_BELOW: f32 = 0.001;

#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::c_void;

    use super::SILENT_BELOW;

    #[repr(C)]
    struct PropertyAddress {
        selector: u32,
        scope: u32,
        element: u32,
    }

    #[link(name = "CoreAudio", kind = "framework")]
    unsafe extern "C" {
        fn AudioObjectHasProperty(object: u32, address: *const PropertyAddress) -> u8;
        fn AudioObjectGetPropertyData(
            object: u32,
            address: *const PropertyAddress,
            qualifier_size: u32,
            qualifier: *const c_void,
            data_size: *mut u32,
            data: *mut c_void,
        ) -> i32;
    }

    const fn code(name: [u8; 4]) -> u32 {
        u32::from_be_bytes(name)
    }

    const SYSTEM_OBJECT: u32 = 1;
    const DEFAULT_OUTPUT: u32 = code(*b"dOut");
    const SCOPE_GLOBAL: u32 = code(*b"glob");
    const SCOPE_OUTPUT: u32 = code(*b"outp");
    const ELEMENT_MAIN: u32 = 0;
    const MUTE: u32 = code(*b"mute");
    // The volume the menu bar slider shows, for devices that only have per-channel volumes too.
    const VIRTUAL_MAIN_VOLUME: u32 = code(*b"vmvc");
    const VOLUME_SCALAR: u32 = code(*b"volm");

    pub struct Output;

    // The same shape as the Windows output, whose setup can fail and which keeps COM state.
    #[allow(clippy::unnecessary_wraps, clippy::unused_self)]
    impl Output {
        pub fn open() -> Option<Self> {
            Some(Self)
        }

        /// The default output can change between reads (headphones plugged in), so it is looked up each time.
        pub fn silent(&mut self) -> Option<bool> {
            let device: u32 = read(SYSTEM_OBJECT, DEFAULT_OUTPUT, SCOPE_GLOBAL)?;
            if read::<u32>(device, MUTE, SCOPE_OUTPUT) == Some(1) {
                return Some(true);
            }
            let volume = read::<f32>(device, VIRTUAL_MAIN_VOLUME, SCOPE_OUTPUT)
                .or_else(|| read::<f32>(device, VOLUME_SCALAR, SCOPE_OUTPUT));
            Some(volume.is_some_and(|level| level < SILENT_BELOW))
        }
    }

    fn read<T: Copy + Default>(object: u32, selector: u32, scope: u32) -> Option<T> {
        let address = PropertyAddress {
            selector,
            scope,
            element: ELEMENT_MAIN,
        };
        let mut value = T::default();
        let mut size = u32::try_from(std::mem::size_of::<T>()).ok()?;
        // SAFETY: the address outlives both calls and `value` holds exactly `size` bytes.
        let status = unsafe {
            if AudioObjectHasProperty(object, &raw const address) == 0 {
                return None;
            }
            AudioObjectGetPropertyData(
                object,
                &raw const address,
                0,
                std::ptr::null(),
                &raw mut size,
                (&raw mut value).cast(),
            )
        };
        (status == 0).then_some(value)
    }
}

#[cfg(windows)]
mod platform {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        IMMDeviceEnumerator, MMDeviceEnumerator, eMultimedia, eRender,
    };
    use windows::Win32::System::Com::{
        CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx,
    };

    use super::SILENT_BELOW;

    pub struct Output {
        enumerator: IMMDeviceEnumerator,
    }

    impl Output {
        pub fn open() -> Option<Self> {
            // SAFETY: called once on this thread, which lives as long as the enumerator.
            unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok().ok()? };
            // SAFETY: COM is initialised on this thread above.
            let enumerator =
                unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }.ok()?;
            Some(Self { enumerator })
        }

        /// The default output can change between reads (headphones plugged in), so it is looked up each time.
        pub fn silent(&mut self) -> Option<bool> {
            // SAFETY: COM calls on the thread that created the enumerator.
            unsafe {
                let device = self
                    .enumerator
                    .GetDefaultAudioEndpoint(eRender, eMultimedia)
                    .ok()?;
                let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None).ok()?;
                if volume.GetMute().ok()?.as_bool() {
                    return Some(true);
                }
                Some(volume.GetMasterVolumeLevelScalar().ok()? < SILENT_BELOW)
            }
        }
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    pub struct Output;

    impl Output {
        pub fn open() -> Option<Self> {
            None
        }

        pub fn silent(&mut self) -> Option<bool> {
            None
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::platform::Output;

    /// Reads the real output; run with `--ignored` while muting and unmuting the Mac.
    #[test]
    #[ignore = "reads this Mac's sound output"]
    fn reads_the_system_output() {
        let mut output = Output::open().expect("open");
        println!("silent: {:?}", output.silent());
    }
}
