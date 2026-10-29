//! `WebDAV` as a [`Bucket`] (spec/store.md, WebDAV): `PUT`, `GET`, `DELETE`, `MKCOL`, and
//! `PROPFIND` with `Depth` always given. After a 401 nothing more is sent until the credentials
//! change, because Nextcloud bans an address after repeated failures.

use std::collections::HashSet;

use quick_xml::Reader;
use quick_xml::events::Event;
use reqwest::{Client, Method, RequestBuilder, StatusCode, Url};
use tokio::sync::Mutex;

use super::http::{Refusal, Transport, refused};
use super::plain::Bucket;
use super::server::{Result, StoreError};

const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>"#;

/// A user name and password for one `WebDAV` folder.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WebDavLogin {
    pub user: String,
    pub password: String,
}

pub struct WebDav {
    base: Url,
    client: Client,
    login: WebDavLogin,
    /// Folders known to exist, so each is created once.
    folders: Mutex<HashSet<String>>,
    refusal: Refusal,
}

impl WebDav {
    /// `url` is the folder that holds the group, such as `https://cloud.example/remote.php/dav/files/me/flow-sync/`.
    pub async fn connect(url: &str, login: WebDavLogin) -> Result<Self> {
        let mut base = Url::parse(url).map_err(|_| StoreError::Insecure)?;
        if !base.path().ends_with('/') {
            base.set_path(&format!("{}/", base.path()));
        }
        let client = Transport::for_url(&base).await?.client()?;
        Ok(Self {
            base,
            client,
            login,
            folders: Mutex::new(HashSet::new()),
            refusal: Refusal::on(&[StatusCode::UNAUTHORIZED]),
        })
    }

    fn request(&self, method: Method, path: &str) -> Result<RequestBuilder> {
        let url = self.base.join(path).map_err(|_| StoreError::Malformed)?;
        Ok(self
            .client
            .request(method, url)
            .basic_auth(&self.login.user, Some(&self.login.password)))
    }

    /// Creates each missing folder above `path`, the group's own folder first. A folder that
    /// exists answers 405.
    async fn make_folders(&self, path: &str) -> Result<()> {
        let mut known = self.folders.lock().await;
        let mut folder = String::new();
        let parts = path.split_inclusive('/').filter(|part| part.ends_with('/'));
        for part in std::iter::once("").chain(parts) {
            folder.push_str(part);
            if known.contains(&folder) {
                continue;
            }
            let mkcol = Method::from_bytes(b"MKCOL").map_err(|_| StoreError::Malformed)?;
            let response = self.refusal.send(self.request(mkcol, &folder)?).await?;
            if !response.status().is_success()
                && response.status() != StatusCode::METHOD_NOT_ALLOWED
            {
                return Err(refused(&response, "webdav"));
            }
            known.insert(folder.clone());
        }
        Ok(())
    }
}

/// The `href`s of a `PROPFIND` answer, each with whether it is a folder.
fn parse_multistatus(xml: &str) -> Vec<(String, bool)> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut entries = Vec::new();
    let (mut href, mut folder, mut in_href) = (None, false, false);
    loop {
        match reader.read_event() {
            Ok(Event::Start(tag)) if tag.local_name().as_ref() == "href" => in_href = true,
            Ok(Event::Start(tag) | Event::Empty(tag))
                if tag.local_name().as_ref() == "collection" =>
            {
                folder = true;
            }
            Ok(Event::Text(text)) if in_href => {
                href = Some(text.into_inner().into_owned());
            }
            Ok(Event::End(tag)) => match tag.local_name().as_ref() {
                "href" => in_href = false,
                "response" => {
                    entries.extend(href.take().map(|h| (h, folder)));
                    folder = false;
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => return entries,
            _ => {}
        }
    }
}

impl Bucket for WebDav {
    async fn put(&self, path: &str, bytes: Vec<u8>) -> Result<()> {
        self.make_folders(path).await?;
        let request = self
            .request(Method::PUT, path)?
            .header("content-type", "application/octet-stream")
            .body(bytes);
        let response = self.refusal.send(request).await?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(refused(&response, "webdav"))
        }
    }

    async fn get(&self, path: &str) -> Result<Option<Vec<u8>>> {
        let response = self.refusal.send(self.request(Method::GET, path)?).await?;
        match response.status() {
            StatusCode::NOT_FOUND => Ok(None),
            status if status.is_success() => Ok(Some(
                response
                    .bytes()
                    .await
                    .map_err(StoreError::Network)?
                    .to_vec(),
            )),
            _ => Err(refused(&response, "webdav")),
        }
    }

    async fn delete(&self, path: &str) -> Result<bool> {
        let response = self
            .refusal
            .send(self.request(Method::DELETE, path)?)
            .await?;
        match response.status() {
            StatusCode::NOT_FOUND => Ok(false),
            status if status.is_success() => Ok(true),
            _ => Err(refused(&response, "webdav")),
        }
    }

    async fn list(&self, dir: &str, after: Option<&str>) -> Result<Vec<String>> {
        let propfind = Method::from_bytes(b"PROPFIND").map_err(|_| StoreError::Malformed)?;
        let request = self
            .request(propfind, dir)?
            .header("depth", "1")
            .header("content-type", "application/xml")
            .body(PROPFIND_BODY);
        let response = self.refusal.send(request).await?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(Vec::new());
        }
        if response.status() != StatusCode::MULTI_STATUS {
            return Err(refused(&response, "webdav"));
        }
        let folder = self.base.join(dir).map_err(|_| StoreError::Malformed)?;
        let xml = response.text().await.map_err(StoreError::Network)?;
        Ok(parse_multistatus(&xml)
            .into_iter()
            .filter_map(|(href, is_folder)| {
                let path = folder.join(&href).ok()?.path().to_owned();
                let name = path.strip_prefix(folder.path())?.trim_end_matches('/');
                let listed = !name.is_empty() && !name.contains('/');
                (listed && after.is_none_or(|after| name > after)).then(|| {
                    if is_folder {
                        format!("{name}/")
                    } else {
                        name.to_owned()
                    }
                })
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_propfind_answer_with_any_prefix() {
        let xml = r#"<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
  <D:response><D:href>/dav/flow/dev/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
  <D:response><D:href>/dav/flow/dev/abc/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>
  <D:response><D:href>/dav/flow/dev/x.o</D:href><D:propstat><D:prop><D:resourcetype/></D:prop></D:propstat></D:response>
</D:multistatus>"#;
        assert_eq!(
            parse_multistatus(xml),
            [
                ("/dav/flow/dev/".to_owned(), true),
                ("/dav/flow/dev/abc/".to_owned(), true),
                ("/dav/flow/dev/x.o".to_owned(), false),
            ]
        );
    }
}
