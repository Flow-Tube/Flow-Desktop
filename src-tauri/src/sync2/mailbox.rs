//! The pairing mailbox (spec/store.md, Pairing mailbox): a short-lived slot where two devices
//! exchange sealed pairing messages before the new one has any roster key.

use std::future::Future;

use super::server::Result;

pub trait Mailbox {
    fn open_slot(&self, slot: &str) -> impl Future<Output = Result<()>> + Send;
    fn put_message(
        &self,
        slot: &str,
        name: &str,
        bytes: Vec<u8>,
    ) -> impl Future<Output = Result<()>> + Send;
    fn get_message(
        &self,
        slot: &str,
        name: &str,
    ) -> impl Future<Output = Result<Option<Vec<u8>>>> + Send;
    fn close_slot(&self, slot: &str) -> impl Future<Output = Result<()>> + Send;
}
