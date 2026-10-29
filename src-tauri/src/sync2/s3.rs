//! S3-compatible storage as a [`Bucket`] (spec/store.md, S3): `PutObject`, `GetObject`,
//! `DeleteObject` and `ListObjectsV2`, signed with `SigV4` by `rusty-s3` and sent over the
//! shared transport rules.

use std::time::Duration;

use reqwest::{Client, Method, StatusCode, Url};
use rusty_s3::actions::ListObjectsV2;
use rusty_s3::{Credentials, S3Action, UrlStyle};

use super::http::{Refusal, Transport, refused};
use super::plain::Bucket;
use super::server::{Result, StoreError};

/// How long a signed request stays valid.
const SIGNED_FOR: Duration = Duration::from_secs(300);

/// Where a group lives in an S3-compatible service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3Location {
    pub endpoint: String,
    pub bucket: String,
    pub region: String,
    /// Prepended to every key, so a bucket can hold more than the group.
    pub prefix: String,
}

/// An access key and its secret.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct S3Login {
    pub access_key: String,
    pub secret_key: String,
}

pub struct S3 {
    bucket: rusty_s3::Bucket,
    credentials: Credentials,
    prefix: String,
    client: Client,
    refusal: Refusal,
}

impl S3 {
    pub async fn connect(location: &S3Location, login: &S3Login) -> Result<Self> {
        let endpoint = Url::parse(&location.endpoint).map_err(|_| StoreError::Insecure)?;
        let client = Transport::for_url(&endpoint).await?.client()?;
        let bucket = rusty_s3::Bucket::new(
            endpoint,
            UrlStyle::Path,
            location.bucket.clone(),
            location.region.clone(),
        )
        .map_err(|_| StoreError::Insecure)?;
        let mut prefix = location.prefix.trim_start_matches('/').to_owned();
        if !prefix.is_empty() && !prefix.ends_with('/') {
            prefix.push('/');
        }
        Ok(Self {
            bucket,
            credentials: Credentials::new(&login.access_key, &login.secret_key),
            prefix,
            client,
            // S3 answers a wrong key or secret with 403.
            refusal: Refusal::on(&[StatusCode::UNAUTHORIZED, StatusCode::FORBIDDEN]),
        })
    }

    fn key(&self, path: &str) -> String {
        format!("{}{path}", self.prefix)
    }

    async fn list_page(
        &self,
        prefix: &str,
        after: Option<&str>,
        token: Option<&str>,
    ) -> Result<rusty_s3::actions::ListObjectsV2Response> {
        let mut action = self.bucket.list_objects_v2(Some(&self.credentials));
        action.with_prefix(prefix);
        action.with_delimiter("/");
        if let Some(after) = after {
            action.with_start_after(after);
        }
        if let Some(token) = token {
            action.with_continuation_token(token);
        }
        let request = self.client.get(action.sign(SIGNED_FOR));
        let response = self.refusal.send(request).await?;
        if !response.status().is_success() {
            return Err(refused(&response, "s3"));
        }
        let xml = response.text().await.map_err(StoreError::Network)?;
        ListObjectsV2::parse_response(&xml).map_err(|_| StoreError::Malformed)
    }
}

impl Bucket for S3 {
    async fn put(&self, path: &str, bytes: Vec<u8>) -> Result<()> {
        let key = self.key(path);
        let url = self
            .bucket
            .put_object(Some(&self.credentials), &key)
            .sign(SIGNED_FOR);
        let response = self.refusal.send(self.client.put(url).body(bytes)).await?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(refused(&response, "s3"))
        }
    }

    async fn get(&self, path: &str) -> Result<Option<Vec<u8>>> {
        let key = self.key(path);
        let url = self
            .bucket
            .get_object(Some(&self.credentials), &key)
            .sign(SIGNED_FOR);
        let response = self.refusal.send(self.client.get(url)).await?;
        match response.status() {
            StatusCode::NOT_FOUND => Ok(None),
            status if status.is_success() => Ok(Some(
                response
                    .bytes()
                    .await
                    .map_err(StoreError::Network)?
                    .to_vec(),
            )),
            _ => Err(refused(&response, "s3")),
        }
    }

    /// S3 has no folders, and answers a delete the same whether the key was there or not.
    async fn delete(&self, path: &str) -> Result<bool> {
        if path.ends_with('/') {
            return Ok(false);
        }
        let key = self.key(path);
        let head = self
            .bucket
            .head_object(Some(&self.credentials), &key)
            .sign(SIGNED_FOR);
        let found = self.refusal.send(self.client.head(head)).await?;
        if found.status() == StatusCode::NOT_FOUND {
            return Ok(false);
        }
        let url = self
            .bucket
            .delete_object(Some(&self.credentials), &key)
            .sign(SIGNED_FOR);
        let response = self
            .refusal
            .send(self.client.request(Method::DELETE, url))
            .await?;
        if response.status().is_success() {
            Ok(true)
        } else {
            Err(refused(&response, "s3"))
        }
    }

    async fn list(&self, dir: &str, after: Option<&str>) -> Result<Vec<String>> {
        let prefix = self.key(dir);
        let after = after.map(|name| format!("{prefix}{name}"));
        let mut names = Vec::new();
        let mut token = None;
        loop {
            let page = self
                .list_page(&prefix, after.as_deref(), token.as_deref())
                .await?;
            let keys = page.contents.into_iter().map(|object| object.key);
            let folders = page.common_prefixes.into_iter().map(|p| p.prefix);
            names.extend(
                keys.chain(folders)
                    .filter_map(|key| key.strip_prefix(&prefix).map(str::to_owned))
                    .filter(|name| !name.is_empty()),
            );
            token = page.next_continuation_token;
            if token.is_none() {
                return Ok(names);
            }
        }
    }
}
