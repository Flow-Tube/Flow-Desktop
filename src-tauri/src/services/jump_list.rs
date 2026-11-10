//! The taskbar Jump List: tasks that start Flow with `--open-page=…`, which the running app picks
//! up through the single-instance plugin.
#![cfg(windows)]

use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, CoCreateInstance, CoInitializeEx,
};
use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, PSCoerceToCanonicalValue};
use windows::Win32::UI::Shell::{
    DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW, ShellLink,
};
use windows::core::{HSTRING, Interface, Result};

use super::shell_pages::{OPEN_PAGE_ARG, ShellLabels};

/// Replaces the list on a thread of its own, since COM needs an apartment and this can take a moment.
pub fn set(labels: ShellLabels) {
    std::thread::spawn(move || {
        if let Err(error) = commit(&labels) {
            tracing::warn!(%error, "Could not set the Jump List");
        }
    });
}

fn commit(labels: &ShellLabels) -> Result<()> {
    let exe = std::env::current_exe().map_err(|_| windows::core::Error::empty())?;
    let exe = HSTRING::from(exe.as_os_str());
    // SAFETY: plain COM calls on interfaces this function owns, on a thread it just initialised.
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let list: ICustomDestinationList =
            CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
        let mut max_slots = 0u32;
        let _removed: IObjectArray = list.BeginList(&mut max_slots)?;
        let tasks: IObjectCollection =
            CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
        for (page, label) in labels.entries() {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(&exe)?;
            link.SetArguments(&HSTRING::from(format!("{OPEN_PAGE_ARG}{page}")))?;
            link.SetIconLocation(&exe, 0)?;
            let properties: IPropertyStore = link.cast()?;
            // From<&str> makes a BSTR; PKEY_Title takes a wide string pointer.
            let mut title = PROPVARIANT::from(label);
            PSCoerceToCanonicalValue(&PKEY_Title, &mut title)?;
            properties.SetValue(&PKEY_Title, &title)?;
            properties.Commit()?;
            tasks.AddObject(&link)?;
        }
        list.AddUserTasks(&tasks.cast::<IObjectArray>()?)?;
        list.CommitList()
    }
}
