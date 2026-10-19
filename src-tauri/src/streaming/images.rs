//! Remote artwork through the local proxy.
//!
//! In the AppImage the webview fetches HTTPS images with the bundled GnuTLS,
//! which only knows the build distro's CA bundle path, so on openSUSE and Fedora
//! every thumbnail and avatar fails while media, fetched by the proxy's own TLS
//! stack, plays (issue #74). There the frontend loads images from
//! `/img/<launch token>?u=<url>` on the image listener instead (see the
//! `image_proxy_base` command).

use std::sync::LazyLock;

use uuid::Uuid;

/// Random per launch, so other local programs can't use the proxy as an open
/// URL fetcher.
static ROUTE_TOKEN: LazyLock<String> = LazyLock::new(|| Uuid::new_v4().simple().to_string());

pub fn route_token() -> &'static str {
    &ROUTE_TOKEN
}

/// Hosts the app loads images from; keep in step with `src/lib/imageProxy.ts`.
/// Anything else (DeArrow can return any thumbnail URL) is fetched by the
/// webview directly.
fn is_proxied_image_host(host: &str) -> bool {
    let host = host.to_ascii_lowercase();
    ["ytimg.com", "ggpht.com", "googleusercontent.com"]
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
        || matches!(host.as_str(), "img.youtube.com" | "dearrow-thumb.ajay.app")
}

/// The upstream URL for an `/img/` request, or `None` when it must be refused.
pub fn image_route_target(token: &str, url: &str) -> Option<String> {
    if token != route_token() {
        return None;
    }
    let parsed = reqwest::Url::parse(url).ok()?;
    (parsed.scheme() == "https" && parsed.host_str().is_some_and(is_proxied_image_host))
        .then(|| proxyable_image_url(&parsed))
}

/// True for hosts that resolve to this machine, which the proxy must never
/// fetch for the webview.
pub fn is_local_host(host: &str) -> bool {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback() || ip.is_unspecified())
}

pub fn image_content_type(url: &str) -> String {
    let lower = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png".to_string()
    } else if lower.ends_with(".webp") {
        "image/webp".to_string()
    } else if lower.ends_with(".gif") {
        "image/gif".to_string()
    } else if lower.ends_with(".svg") {
        "image/svg+xml".to_string()
    } else {
        "image/jpeg".to_string()
    }
}

fn google_size_param_start(url: &str) -> Option<usize> {
    ["=w", "=h", "=s"]
        .iter()
        .filter_map(|marker| url.find(marker))
        .min()
}

pub fn proxyable_image_url(parsed: &reqwest::Url) -> String {
    let url = parsed.as_str();
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if !(host.starts_with("yt3.") || host == "yt3.googleusercontent.com" || host == "yt3.ggpht.com")
    {
        return url.to_string();
    }

    let (base_and_path, query) = url
        .split_once('?')
        .map_or((url, ""), |(base, query)| (base, query));

    if google_size_param_start(base_and_path).is_some() {
        return url.to_string();
    }

    if query.is_empty() {
        format!("{base_and_path}=s512")
    } else {
        format!("{base_and_path}=s512?{query}")
    }
}

#[cfg(test)]
mod tests {
    use super::{image_route_target, is_local_host, route_token};

    #[test]
    fn youtube_image_hosts_are_proxied() {
        for url in [
            "https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg",
            "https://i9.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
            "https://img.youtube.com/vi/dQw4w9WgXcQ/0.jpg",
            "https://lh3.googleusercontent.com/abc=w544-h544",
            "https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=dQw4w9WgXcQ&time=12",
        ] {
            assert_eq!(
                image_route_target(route_token(), url).as_deref(),
                Some(url),
                "{url}"
            );
        }
    }

    #[test]
    fn channel_avatars_get_a_size_like_the_command_path() {
        assert_eq!(
            image_route_target(route_token(), "https://yt3.ggpht.com/abc").as_deref(),
            Some("https://yt3.ggpht.com/abc=s512")
        );
    }

    #[test]
    fn other_hosts_plain_http_and_bad_tokens_are_refused() {
        assert_eq!(
            image_route_target(route_token(), "https://example.com/a.jpg"),
            None
        );
        assert_eq!(
            image_route_target(route_token(), "https://i.ytimg.com.example.com/a.jpg"),
            None
        );
        assert_eq!(
            image_route_target(route_token(), "http://i.ytimg.com/vi/x/hq720.jpg"),
            None
        );
        assert_eq!(
            image_route_target("guess", "https://i.ytimg.com/vi/x/hq720.jpg"),
            None
        );
    }

    #[test]
    fn loopback_and_unspecified_hosts_are_local() {
        for host in [
            "localhost",
            "127.0.0.1",
            "127.0.0.2",
            "0.0.0.0",
            "[::1]",
            "::",
        ] {
            assert!(is_local_host(host), "{host}");
        }
        assert!(!is_local_host("i.ytimg.com"));
        assert!(!is_local_host("192.168.1.10"));
    }
}
