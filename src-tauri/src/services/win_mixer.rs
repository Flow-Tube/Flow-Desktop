//! Names Flow's audio in the Windows volume mixer.
//!
//! The webview plays sound from its own `msedgewebview2.exe` child process, so the mixer
//! shows it under Edge's name and icon (`MicrosoftEdge/WebView2Feedback#2236`). This
//! watches the audio sessions on every output device and renames the ones whose process
//! is a WebView2 process descended from Flow's.
//!
//! Ported from Drapondur/ChangeVolumeMixerForWebView (MIT License, Copyright (c) 2023 Drapondur).
#![cfg(windows)]
// The `#[implement]` expansion trips these.
#![allow(clippy::inline_always, clippy::ref_as_ptr)]

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::mpsc::{self, Sender};

use tauri::AppHandle;
use windows::Win32::Foundation::{CloseHandle, PROPERTYKEY, S_OK};
use windows::Win32::Media::Audio::{
    DEVICE_STATE, DEVICE_STATE_ACTIVE, EDataFlow, ERole, IAudioSessionControl,
    IAudioSessionControl2, IAudioSessionManager2, IAudioSessionNotification,
    IAudioSessionNotification_Impl, IMMDevice, IMMDeviceEnumerator, IMMEndpoint,
    IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator, eRender,
};
use windows::Win32::System::Com::{
    CLSCTX_ALL, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, CoTaskMemFree,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::core::{HSTRING, Interface, PCWSTR, Ref, Result, implement};

struct Label {
    name: HSTRING,
    icon: HSTRING,
}

enum DeviceChange {
    Active(String),
    Gone(String),
}

/// Starts a background thread that labels Flow's audio sessions for the life of the app.
pub fn start(app: &AppHandle) {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let label = Arc::new(Label {
        name: app
            .config()
            .product_name
            .as_deref()
            .unwrap_or("Flow")
            .into(),
        // tauri-build embeds the app icon under resource ID 32512. Naming it by ID rather than
        // by index lets EarTrumpet load it, as well as the Windows mixer.
        icon: format!("{},-32512", exe.display()).into(),
    });
    let spawned = std::thread::Builder::new()
        .name("win-mixer".into())
        .spawn(move || {
            if let Err(error) = watch_devices(&label) {
                tracing::warn!(%error, "Failed to label Flow in the volume mixer");
            }
        });
    if let Err(error) = spawned {
        tracing::warn!(%error, "Failed to start the volume mixer thread");
    }
}

fn watch_devices(label: &Arc<Label>) -> Result<()> {
    // Session notifications are only delivered to a multithreaded apartment.
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };

    let (changes, received) = mpsc::channel();
    let device_events: IMMNotificationClient = DeviceEvents { changes }.into();
    unsafe { enumerator.RegisterEndpointNotificationCallback(&device_events)? };
    let session_events: IAudioSessionNotification = SessionEvents {
        label: label.clone(),
    }
    .into();

    // Each manager stays registered for as long as it is kept here.
    let mut watched: HashMap<String, IAudioSessionManager2> = HashMap::new();
    let active = unsafe { enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)? };
    for index in 0..unsafe { active.GetCount()? } {
        let device = unsafe { active.Item(index)? };
        if let Err(error) = watch_device(&device, &session_events, label, &mut watched) {
            tracing::debug!(%error, "Skipped an audio device for the volume mixer");
        }
    }

    for change in received {
        match change {
            DeviceChange::Active(id) => {
                let Ok(device) = (unsafe { enumerator.GetDevice(&HSTRING::from(id)) }) else {
                    continue;
                };
                if let Err(error) = watch_device(&device, &session_events, label, &mut watched) {
                    tracing::debug!(%error, "Skipped an audio device for the volume mixer");
                }
            }
            DeviceChange::Gone(id) => {
                if let Some(manager) = watched.remove(&id) {
                    let _ = unsafe { manager.UnregisterSessionNotification(&session_events) };
                }
            }
        }
    }
    Ok(())
}

fn watch_device(
    device: &IMMDevice,
    session_events: &IAudioSessionNotification,
    label: &Label,
    watched: &mut HashMap<String, IAudioSessionManager2>,
) -> Result<()> {
    let id = unsafe {
        let raw = device.GetId()?;
        let id = raw.to_string();
        CoTaskMemFree(Some(raw.0 as *const _));
        id?
    };
    if watched.contains_key(&id)
        || unsafe { device.cast::<IMMEndpoint>()?.GetDataFlow()? } != eRender
        || unsafe { device.GetState()? } != DEVICE_STATE_ACTIVE
    {
        return Ok(());
    }

    let manager: IAudioSessionManager2 = unsafe { device.Activate(CLSCTX_ALL, None)? };
    unsafe { manager.RegisterSessionNotification(session_events)? };
    // Notifications only start once the sessions have been enumerated.
    let sessions = unsafe { manager.GetSessionEnumerator()? };
    for index in 0..unsafe { sessions.GetCount()? } {
        let _ = label_if_ours(&unsafe { sessions.GetSession(index)? }, label);
    }
    watched.insert(id, manager);
    Ok(())
}

fn label_if_ours(session: &IAudioSessionControl, label: &Label) -> Result<()> {
    let session: IAudioSessionControl2 = session.cast()?;
    if unsafe { session.IsSystemSoundsSession() } == S_OK {
        return Ok(());
    }
    if !descends_from_flow(unsafe { session.GetProcessId()? }) {
        return Ok(());
    }
    unsafe {
        session.SetDisplayName(&label.name, std::ptr::null())?;
        session.SetIconPath(&label.icon, std::ptr::null())
    }
}

fn descends_from_flow(pid: u32) -> bool {
    let parents = webview_parent_pids();
    let flow = std::process::id();
    let mut current = pid;
    // Bounded in case a reused process id makes a loop.
    for _ in 0..16 {
        match parents.get(&current) {
            Some(&parent) if parent == flow => return true,
            Some(&parent) if parent != 0 => current = parent,
            _ => return false,
        }
    }
    false
}

/// Only WebView2's processes, because a browser Flow starts to open a link is its child too.
fn webview_parent_pids() -> HashMap<u32, u32> {
    let mut parents = HashMap::new();
    let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
        return parents;
    };
    let mut entry = PROCESSENTRY32W {
        #[allow(clippy::cast_possible_truncation)] // A struct size always fits.
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut found = unsafe { Process32FirstW(snapshot, &raw mut entry) };
    while found.is_ok() {
        if is_webview(&entry.szExeFile) {
            parents.insert(entry.th32ProcessID, entry.th32ParentProcessID);
        }
        found = unsafe { Process32NextW(snapshot, &raw mut entry) };
    }
    let _ = unsafe { CloseHandle(snapshot) };
    parents
}

fn is_webview(exe: &[u16]) -> bool {
    let len = exe.iter().position(|&unit| unit == 0).unwrap_or(exe.len());
    String::from_utf16_lossy(&exe[..len]).eq_ignore_ascii_case("msedgewebview2.exe")
}

#[implement(IAudioSessionNotification)]
struct SessionEvents {
    label: Arc<Label>,
}

impl IAudioSessionNotification_Impl for SessionEvents_Impl {
    fn OnSessionCreated(&self, session: Ref<IAudioSessionControl>) -> Result<()> {
        if let Some(session) = session.as_ref() {
            let _ = label_if_ours(session, &self.label);
        }
        Ok(())
    }
}

#[implement(IMMNotificationClient)]
struct DeviceEvents {
    changes: Sender<DeviceChange>,
}

impl DeviceEvents_Impl {
    fn send(&self, id: PCWSTR, active: bool) {
        let Ok(id) = (unsafe { id.to_string() }) else {
            return;
        };
        let _ = self.changes.send(if active {
            DeviceChange::Active(id)
        } else {
            DeviceChange::Gone(id)
        });
    }
}

impl IMMNotificationClient_Impl for DeviceEvents_Impl {
    fn OnDeviceStateChanged(&self, id: &PCWSTR, state: DEVICE_STATE) -> Result<()> {
        self.send(*id, state == DEVICE_STATE_ACTIVE);
        Ok(())
    }

    fn OnDeviceAdded(&self, id: &PCWSTR) -> Result<()> {
        self.send(*id, true);
        Ok(())
    }

    fn OnDeviceRemoved(&self, id: &PCWSTR) -> Result<()> {
        self.send(*id, false);
        Ok(())
    }

    fn OnDefaultDeviceChanged(&self, _: EDataFlow, _: ERole, _: &PCWSTR) -> Result<()> {
        Ok(())
    }

    fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> Result<()> {
        Ok(())
    }
}
