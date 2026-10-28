use super::kdf::{derive, tag};

/// The mDNS TXT tag for one hour; members check the previous, current and next hour.
pub fn lan_tag(lan_key: &[u8], unix_seconds: u64) -> Vec<u8> {
    derive::<8>(
        lan_key,
        &[],
        "lan tag",
        &(unix_seconds / 3600).to_be_bytes(),
    )
    .to_vec()
}

pub fn lan_hello_aad(message: u8) -> Vec<u8> {
    [&tag("lan hello")[..], &[message]].concat()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LanRole {
    Server,
    Client,
}

pub fn lan_transcript(
    role: LanRole,
    client_nonce: &[u8],
    server_nonce: &[u8],
    client: &[u8],
    server: &[u8],
) -> Vec<u8> {
    let label = match role {
        LanRole::Server => "lan server",
        LanRole::Client => "lan client",
    };
    [&tag(label)[..], client_nonce, server_nonce, client, server].concat()
}

pub struct LanSessionKeys {
    pub client_to_server: Vec<u8>,
    pub server_to_client: Vec<u8>,
}

pub fn lan_session_keys(
    lan_key: &[u8],
    client_nonce: &[u8],
    server_nonce: &[u8],
    client: &[u8],
    server: &[u8],
) -> LanSessionKeys {
    let salt = [client_nonce, server_nonce].concat();
    let dids = [client, server].concat();
    LanSessionKeys {
        client_to_server: derive::<32>(lan_key, &salt, "lan c2s", &dids).to_vec(),
        server_to_client: derive::<32>(lan_key, &salt, "lan s2c", &dids).to_vec(),
    }
}

pub fn lan_frame_aad(seq: u64) -> Vec<u8> {
    [&tag("lan")[..], &seq.to_be_bytes()].concat()
}
