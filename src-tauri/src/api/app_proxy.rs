//! The proxy the user set in Settings, for every client that reaches the internet.
//!
//! Each client asks [`route`] for every new connection, so one built before the
//! saved proxy loaded, or before the user changed it, still follows it. Devices on
//! the local network stay direct, as device sync needs. With no proxy set, a client
//! keeps using the system's or the environment's, which `ClientBuilder::proxy` would
//! otherwise switch off.
//!
//! `BotGuard` token minting doesn't go through this: the sidecar and the webview that
//! mint tokens connect directly, as Android's `WebView` does.

use std::sync::{LazyLock, RwLock};

use base64::Engine;
use hyper_util::client::proxy::matcher::Matcher;
use reqwest::{ClientBuilder, Proxy, Url};

pub const ENABLED_SETTING: &str = "proxy_enabled";
pub const TYPE_SETTING: &str = "proxy_type";
pub const HOST_SETTING: &str = "proxy_host";
pub const PORT_SETTING: &str = "proxy_port";
pub const USERNAME_SETTING: &str = "proxy_username";
pub const PASSWORD_SETTING: &str = "proxy_password";

#[derive(Clone, Default)]
struct ProxyConfig {
    enabled: bool,
    kind: String,
    host: String,
    port: String,
    username: String,
    password: String,
}

/// The port Settings shows before one is typed. The screen doesn't save it until the field is
/// edited, so a saved proxy can have no port at all.
const DEFAULT_PORT: u16 = 8080;

static CONFIG: RwLock<Option<ProxyConfig>> = RwLock::new(None);
static SYSTEM: LazyLock<Matcher> = LazyLock::new(Matcher::from_system);

/// Whether `key` is one of the proxy settings; if so, the new value is in force.
pub fn apply_setting(key: &str, value: Option<&str>) -> bool {
    let mut config = CONFIG
        .write()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let config = config.get_or_insert_with(ProxyConfig::default);
    let value = value.unwrap_or_default();
    match key {
        ENABLED_SETTING => config.enabled = value.eq_ignore_ascii_case("true"),
        TYPE_SETTING => value.clone_into(&mut config.kind),
        HOST_SETTING => value.trim().clone_into(&mut config.host),
        PORT_SETTING => value.trim().clone_into(&mut config.port),
        USERNAME_SETTING => value.trim().clone_into(&mut config.username),
        PASSWORD_SETTING => value.clone_into(&mut config.password),
        _ => return false,
    }
    true
}

/// Sends a client's connections through the proxy in force at the time.
pub fn with_app_proxy(builder: ClientBuilder) -> ClientBuilder {
    builder.proxy(Proxy::custom(route))
}

fn route(destination: &Url) -> Option<Url> {
    let host = destination.host_str().unwrap_or_default();
    if is_local_host(host) {
        return None;
    }
    let config = CONFIG
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .clone();
    match config.as_ref().filter(|config| config.enabled) {
        Some(config) => proxy_url(config),
        None => system_proxy(destination),
    }
}

/// The URL of a usable proxy. Host names are left for the proxy to resolve, so a
/// lookup doesn't give away what is being visited.
fn proxy_url(config: &ProxyConfig) -> Option<Url> {
    let port: u16 = if config.port.is_empty() {
        DEFAULT_PORT
    } else {
        config.port.parse().ok().filter(|port| *port != 0)?
    };
    if config.host.is_empty() {
        return None;
    }
    let scheme = match config.kind.as_str() {
        "socks5" => "socks5h",
        "socks4" => "socks4a",
        _ => "http",
    };
    let host = if config.host.contains(':') && !config.host.starts_with('[') {
        format!("[{}]", config.host)
    } else {
        config.host.clone()
    };
    let mut url = Url::parse(&format!("{scheme}://{host}:{port}")).ok()?;
    if !config.username.is_empty() {
        url.set_username(&config.username).ok()?;
        if !config.password.is_empty() {
            url.set_password(Some(&config.password)).ok()?;
        }
    }
    Some(url)
}

fn system_proxy(destination: &Url) -> Option<Url> {
    let destination: hyper::Uri = destination.as_str().parse().ok()?;
    let intercept = SYSTEM.intercept(&destination)?;
    let mut url = Url::parse(&intercept.uri().to_string()).ok()?;
    let credentials = intercept
        .raw_auth()
        .map(|(user, password)| (user.to_owned(), password.to_owned()))
        .or_else(|| {
            let header = intercept.basic_auth()?.to_str().ok()?;
            let encoded = header.strip_prefix("Basic ")?;
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .ok()?;
            let decoded = String::from_utf8(decoded).ok()?;
            let (user, password) = decoded.split_once(':')?;
            Some((user.to_owned(), password.to_owned()))
        });
    if let Some((user, password)) = credentials {
        url.set_username(&user).ok()?;
        url.set_password(Some(&password)).ok()?;
    }
    Some(url)
}

/// Whether `host` names this device or one on the local network. Only literal
/// addresses and local names count: resolving a name here would cost a lookup.
fn is_local_host(host: &str) -> bool {
    let name = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    let is_local_name = name
        .rsplit_once('.')
        .is_some_and(|(_, domain)| domain == "local");
    if name == "localhost" || is_local_name {
        return true;
    }
    if name.contains(':') {
        return name == "::1"
            || name.starts_with("fe80:")
            || name.starts_with("fc")
            || name.starts_with("fd");
    }
    let Ok(address) = name.parse::<std::net::Ipv4Addr>() else {
        return false;
    };
    address.is_loopback() || address.is_private() || address.is_link_local()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(kind: &str, host: &str, port: &str) -> ProxyConfig {
        ProxyConfig {
            enabled: true,
            kind: kind.into(),
            host: host.into(),
            port: port.into(),
            ..ProxyConfig::default()
        }
    }

    #[test]
    fn builds_the_url_for_each_protocol() {
        let url = |c: &ProxyConfig| proxy_url(c).map(|u| u.to_string());
        assert_eq!(
            url(&config("http", "proxy.test", "8080")).as_deref(),
            Some("http://proxy.test:8080/")
        );
        assert_eq!(
            url(&config("socks5", "proxy.test", "1080")).as_deref(),
            Some("socks5h://proxy.test:1080")
        );
        assert_eq!(
            url(&config("socks4", "proxy.test", "1080")).as_deref(),
            Some("socks4a://proxy.test:1080")
        );
        assert_eq!(
            url(&config("http", "2001:db8::1", "8080")).as_deref(),
            Some("http://[2001:db8::1]:8080/")
        );
    }

    #[test]
    fn an_unusable_endpoint_is_no_proxy() {
        assert!(proxy_url(&config("http", "", "8080")).is_none());
        assert!(proxy_url(&config("http", "proxy.test", "0")).is_none());
        assert!(proxy_url(&config("http", "proxy.test", "70000")).is_none());
    }

    #[test]
    fn no_saved_port_means_the_port_settings_shows() {
        assert_eq!(
            proxy_url(&config("http", "proxy.test", "")).map(|u| u.to_string()),
            Some("http://proxy.test:8080/".to_owned())
        );
        let never_saved = ProxyConfig {
            enabled: true,
            host: "proxy.test".into(),
            ..ProxyConfig::default()
        };
        assert_eq!(proxy_url(&never_saved).unwrap().port(), Some(8080));
    }

    #[test]
    fn escapes_credentials() {
        let mut signed_in = config("http", "proxy.test", "8080");
        signed_in.username = "a user".into();
        signed_in.password = "p@ss:word".into();
        let url = proxy_url(&signed_in).unwrap();
        assert_eq!(url.username(), "a%20user");
        assert_eq!(url.password(), Some("p%40ss%3Aword"));
    }

    #[test]
    fn local_devices_stay_direct() {
        for host in [
            "localhost",
            "flow.local",
            "127.0.0.1",
            "10.0.0.2",
            "172.16.4.1",
            "192.168.1.9",
            "169.254.0.1",
            "[::1]",
            "[fe80::1]",
            "[fd00::1]",
        ] {
            assert!(is_local_host(host), "{host}");
        }
        for host in ["youtube.com", "8.8.8.8", "172.32.0.1", "[2001:db8::1]"] {
            assert!(!is_local_host(host), "{host}");
        }
    }

    /// Answers one request as an HTTP proxy would, and returns the request line it saw.
    async fn one_proxied_request(listener: tokio::net::TcpListener) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = vec![0_u8; 2048];
        let read = socket.read(&mut request).await.unwrap();
        socket
            .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok")
            .await
            .unwrap();
        String::from_utf8_lossy(&request[..read])
            .lines()
            .next()
            .unwrap()
            .to_owned()
    }

    // One test, because the settings are process-wide.
    #[tokio::test]
    async fn a_client_built_before_the_setting_follows_it() {
        let client = with_app_proxy(reqwest::Client::builder()).build().unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port().to_string();
        for (key, value) in [
            (TYPE_SETTING, "http"),
            (HOST_SETTING, " 127.0.0.1 "),
            (PORT_SETTING, port.as_str()),
            (ENABLED_SETTING, "true"),
        ] {
            assert!(apply_setting(key, Some(value)));
        }
        assert!(!apply_setting("theme_id", Some("x")));

        let proxy = tokio::spawn(one_proxied_request(listener));
        let response = client.get("http://flow.test/page").send().await.unwrap();
        assert_eq!(response.text().await.unwrap(), "ok");
        assert_eq!(proxy.await.unwrap(), "GET http://flow.test/page HTTP/1.1");

        let lan = Url::parse("http://192.168.1.9:8000/").unwrap();
        assert!(route(&lan).is_none());

        apply_setting(ENABLED_SETTING, Some("false"));
        let youtube = Url::parse("https://www.youtube.com/").unwrap();
        assert_eq!(route(&youtube), system_proxy(&youtube));
    }
}
