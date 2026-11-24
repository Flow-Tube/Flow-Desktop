//! Why a store could not be reached, so the message can say what to check instead of one
//! "Couldn't reach the server" for every cause (#2233). Follows Flow for Android's
//! `NetworkFailure`.

use std::error::Error as StdError;
use std::io;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkFailure {
    /// Nothing answered at the address within the connect timeout: wrong address or port, or a
    /// firewall.
    ConnectTimeout,
    /// The address answered, and nothing listens on that port.
    ConnectionRefused,
    /// The name does not resolve, or there is no route to the address.
    NoSuchHost,
    /// Connected, then the server stopped answering.
    NoAnswer,
    /// Something answered that does not speak HTTP, or HTTPS was expected and not offered.
    NotHttp,
    Other,
}

/// What the causes under a transport error point to, weakest first: when several show, the
/// strongest names the failure.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Cause {
    #[default]
    Unknown,
    /// The TLS handshake failed, or the answer couldn't be read as HTTP.
    Garbled,
    Refused,
    Unreachable,
    Dns,
}

/// What a transport error says about itself.
#[derive(Debug, Clone, Copy)]
struct Signs {
    connect: bool,
    timeout: bool,
    cause: Cause,
}

impl NetworkFailure {
    pub fn of(error: &reqwest::Error) -> Self {
        Self::from_signs(signs(error))
    }

    /// The `EngineError::kind` the interface shows for it.
    pub fn kind(self) -> &'static str {
        match self {
            Self::ConnectTimeout => "linkedConnectTimeout",
            Self::ConnectionRefused => "linkedConnectionRefused",
            Self::NoSuchHost => "linkedNoSuchHost",
            Self::NoAnswer => "linkedNoAnswer",
            Self::NotHttp => "linkedNotHttp",
            Self::Other => "linkedUnreachable",
        }
    }

    fn from_signs(signs: Signs) -> Self {
        match signs.cause {
            Cause::Dns => Self::NoSuchHost,
            _ if signs.connect && signs.timeout => Self::ConnectTimeout,
            Cause::Unreachable if signs.connect => Self::NoSuchHost,
            Cause::Refused if signs.connect => Self::ConnectionRefused,
            Cause::Garbled => Self::NotHttp,
            _ if signs.timeout => Self::NoAnswer,
            _ => Self::Other,
        }
    }
}

/// Every error under `error`. An `io::Error` that wraps another skips it in `source()`, which
/// hides the TLS failure reqwest wraps in its own `io::Error`, so this steps into it.
fn causes(error: &reqwest::Error) -> impl Iterator<Item = &(dyn StdError + 'static)> {
    std::iter::successors(error.source(), |&cause| {
        match cause
            .downcast_ref::<io::Error>()
            .and_then(io::Error::get_ref)
        {
            Some(inner) => Some(inner as &(dyn StdError + 'static)),
            None => cause.source(),
        }
    })
}

/// The causes under `error`, for a log. A nested `reqwest::Error` is left out, since its text can
/// carry the full URL.
pub fn cause_text(error: &reqwest::Error) -> String {
    let mut parts: Vec<String> = causes(error)
        .filter(|cause| !cause.is::<reqwest::Error>())
        .map(ToString::to_string)
        .collect();
    parts.dedup();
    parts.join(": ")
}

fn signs(error: &reqwest::Error) -> Signs {
    let connect = error.is_connect();
    let text = cause_text(error);
    let from_text = [
        (error.is_dns(), Cause::Dns),
        (says_unreachable(&text), Cause::Unreachable),
        (says_refused(&text), Cause::Refused),
    ];
    let found = causes(error).map(|cause| {
        if cause
            .downcast_ref::<hyper::Error>()
            .is_some_and(hyper::Error::is_parse)
        {
            return Cause::Garbled;
        }
        match cause.downcast_ref::<io::Error>().map(io::Error::kind) {
            Some(io::ErrorKind::ConnectionRefused) => Cause::Refused,
            Some(io::ErrorKind::HostUnreachable | io::ErrorKind::NetworkUnreachable) => {
                Cause::Unreachable
            }
            // tokio-rustls reports a failed handshake as invalid data.
            Some(io::ErrorKind::InvalidData) if connect => Cause::Garbled,
            _ => Cause::Unknown,
        }
    });
    Signs {
        connect,
        timeout: error.is_timeout(),
        cause: from_text
            .into_iter()
            .filter_map(|(shows, cause)| shows.then_some(cause))
            .chain(found)
            .max()
            .unwrap_or_default(),
    }
}

/// A proxy or an OS that wraps the socket error leaves only its text.
fn says_refused(text: &str) -> bool {
    text.to_ascii_lowercase().contains("refused")
        || [
            "ECONNREFUSED",
            "os error 61)",
            "os error 111)",
            "os error 10061)",
        ]
        .iter()
        .any(|sign| text.contains(sign))
}

fn says_unreachable(text: &str) -> bool {
    [
        "EHOSTUNREACH",
        "ENETUNREACH",
        "No route to host",
        "Network is unreachable",
        "os error 51)",
        "os error 65)",
        "os error 101)",
        "os error 113)",
        "os error 10051)",
        "os error 10065)",
    ]
    .iter()
    .any(|sign| text.contains(sign))
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use reqwest::{Client, Url};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::*;
    use crate::sync2::http::Transport;

    #[test]
    fn each_sign_names_its_failure() {
        let of = |connect, timeout, cause| {
            NetworkFailure::from_signs(Signs {
                connect,
                timeout,
                cause,
            })
        };
        assert_eq!(
            of(true, true, Cause::Unknown),
            NetworkFailure::ConnectTimeout
        );
        assert_eq!(
            of(true, true, Cause::Refused),
            NetworkFailure::ConnectTimeout
        );
        assert_eq!(
            of(true, false, Cause::Refused),
            NetworkFailure::ConnectionRefused
        );
        assert_eq!(
            of(true, false, Cause::Unreachable),
            NetworkFailure::NoSuchHost
        );
        assert_eq!(of(false, false, Cause::Dns), NetworkFailure::NoSuchHost);
        assert_eq!(of(true, false, Cause::Garbled), NetworkFailure::NotHttp);
        assert_eq!(of(false, false, Cause::Garbled), NetworkFailure::NotHttp);
        assert_eq!(of(false, true, Cause::Unknown), NetworkFailure::NoAnswer);
        assert_eq!(of(false, false, Cause::Refused), NetworkFailure::Other);
        assert_eq!(of(true, false, Cause::Unknown), NetworkFailure::Other);
    }

    #[test]
    fn the_strongest_cause_wins() {
        assert!(Cause::Dns > Cause::Unreachable);
        assert!(Cause::Unreachable > Cause::Refused);
        assert!(Cause::Refused > Cause::Garbled);
        assert!(Cause::Garbled > Cause::Unknown);
    }

    #[test]
    fn reads_the_socket_error_from_its_text() {
        assert!(says_refused(
            "tcp connect error: Connection refused (os error 61)"
        ));
        assert!(says_refused("io error: os error 111)"));
        assert!(!says_refused("tcp connect error: (os error 611)"));
        assert!(says_unreachable(
            "tcp connect error: No route to host (os error 65)"
        ));
        assert!(says_unreachable("connect failed: EHOSTUNREACH"));
        assert!(!says_unreachable("tcp connect error: (os error 1130)"));
    }

    async fn client(url: &Url) -> Client {
        Transport::for_url(url)
            .await
            .unwrap()
            .builder()
            .read_timeout(Duration::from_millis(200))
            .build()
            .unwrap()
    }

    async fn failure(url: &str) -> NetworkFailure {
        let url = Url::parse(url).unwrap();
        let error = client(&url).await.get(url).send().await.unwrap_err();
        NetworkFailure::of(&error)
    }

    /// A server on a local port that reads the request and then does what `answer` says.
    async fn server<F, Fut>(answer: F) -> u16
    where
        F: Fn(tokio::net::TcpStream) -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let mut request = [0; 1024];
                let _ = stream.read(&mut request).await;
                tokio::spawn(answer(stream));
            }
        });
        port
    }

    #[tokio::test]
    async fn a_closed_port_refuses_the_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        assert_eq!(
            failure(&format!("http://127.0.0.1:{port}/")).await,
            NetworkFailure::ConnectionRefused
        );
    }

    #[tokio::test]
    async fn a_server_that_never_answers_is_no_answer() {
        let port = server(|stream| async move {
            tokio::time::sleep(Duration::from_secs(5)).await;
            drop(stream);
        })
        .await;
        assert_eq!(
            failure(&format!("http://127.0.0.1:{port}/")).await,
            NetworkFailure::NoAnswer
        );
    }

    #[tokio::test]
    async fn an_answer_that_is_not_http_is_not_http() {
        let port = server(|mut stream| async move {
            let _ = stream.write_all(b"SSH-2.0-OpenSSH_9.6\r\n").await;
        })
        .await;
        assert_eq!(
            failure(&format!("http://127.0.0.1:{port}/")).await,
            NetworkFailure::NotHttp
        );
    }

    #[tokio::test]
    async fn https_to_a_plain_server_is_not_http() {
        let port = server(|mut stream| async move {
            let _ = stream
                .write_all(b"HTTP/1.1 400 Bad Request\r\ncontent-length: 0\r\n\r\n")
                .await;
        })
        .await;
        assert_eq!(
            failure(&format!("https://127.0.0.1:{port}/")).await,
            NetworkFailure::NotHttp
        );
    }
}
