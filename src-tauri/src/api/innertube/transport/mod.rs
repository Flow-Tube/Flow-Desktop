//! How every `InnerTube` request is built and sent: one place for the headers,
//! the context, the visitor identity, timeouts, retries and error kinds, so no
//! endpoint can drift from the others.

pub mod error;
pub mod request;
pub mod send;
