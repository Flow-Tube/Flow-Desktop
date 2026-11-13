//! Which Linux firewalls are installed, so a pairing that never connects can show the command
//! for this computer's firewall. Nothing here can tell whether a port is blocked: ufw and firewalld
//! both let loopback through, so a connection to ourselves always succeeds. The other device is
//! the only one that sees the block, so this only names the tools.

/// Where each firewall's command line tool is installed.
const FIREWALLS: [(&str, &[&str]); 2] = [
    ("ufw", &["/usr/sbin/ufw", "/usr/bin/ufw", "/sbin/ufw"]),
    (
        "firewalld",
        &[
            "/usr/bin/firewall-cmd",
            "/usr/sbin/firewall-cmd",
            "/bin/firewall-cmd",
        ],
    ),
];

/// The firewalls whose tools exist according to `exists`.
pub fn installed_with(exists: impl Fn(&str) -> bool) -> Vec<&'static str> {
    FIREWALLS
        .iter()
        .filter(|(_, paths)| paths.iter().any(|path| exists(path)))
        .map(|(name, _)| *name)
        .collect()
}

/// The firewalls installed on this computer; none off Linux, where Flow's text covers the OS's own.
#[must_use]
pub fn installed() -> Vec<&'static str> {
    if cfg!(target_os = "linux") {
        installed_with(|path| std::path::Path::new(path).exists())
    } else {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::installed_with;

    #[test]
    fn names_each_installed_firewall_once() {
        let found =
            installed_with(|path| path == "/usr/sbin/ufw" || path.ends_with("firewall-cmd"));
        assert_eq!(found, vec!["ufw", "firewalld"]);
    }

    #[test]
    fn names_nothing_without_a_firewall() {
        assert!(installed_with(|_| false).is_empty());
    }
}
