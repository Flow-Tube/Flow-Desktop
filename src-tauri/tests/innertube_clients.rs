//! Guards on the InnerTube client registry.
//!
//! These lock the two properties that broke playback before the registry existed:
//! a PO token being sent to a client whose attestation platform cannot validate it
//! (googlevideo refuses the claim, which is worse than sending nothing), and a
//! client's identity disagreeing with itself between the request and the media
//! fetch that follows it.

use flow_desktop_lib::api::innertube::core::clients::{
    self, ANDROID, ANDROID_CREATOR, ANDROID_VR, ANDROID_VR_1_43_32, ANDROID_VR_NO_AUTH,
    AttestationPlatform, IOS, IPADOS, TVHTML5_SIMPLY_EMBEDDED_PLAYER, VISIONOS, WEB, WEB_REMIX,
};
use flow_desktop_lib::api::innertube::music::clients::DIRECT_AUDIO_CLIENTS;

#[test]
fn non_web_clients_never_carry_a_botguard_token() {
    for client in [VISIONOS, IOS, IPADOS, ANDROID, ANDROID_VR, ANDROID_CREATOR] {
        let context = client.player_context(Some("visitor"), Some("a-botguard-token"), None);
        assert!(
            context.get("serviceIntegrityDimensions").is_none(),
            "{} is attested by {:?}, so a BotGuard token must not be attached",
            client.name,
            client.attestation
        );
        assert!(!client.accepts_web_po_token(), "{}", client.name);
    }
}

#[test]
fn web_family_does_carry_a_botguard_token() {
    let context = WEB.player_context(Some("visitor"), Some("a-botguard-token"), None);
    assert_eq!(
        context["serviceIntegrityDimensions"]["poToken"], "a-botguard-token",
        "WEB is the one family Flow can attest, so it must send the token"
    );
    assert_eq!(WEB.attestation, AttestationPlatform::Web);
}

#[test]
fn an_empty_token_is_never_attached() {
    let context = WEB.player_context(Some("visitor"), Some(""), None);
    assert!(context.get("serviceIntegrityDimensions").is_none());
}

#[test]
fn every_client_user_agent_embeds_its_own_version() {
    // The drift this registry replaced: ANDROID was requested as 21.03.38 while
    // its media bytes were fetched with a 19.29.37 User-Agent. Mobile clients name
    // their version in the UA, so the two can be checked against each other.
    for client in [
        ANDROID,
        ANDROID_CREATOR,
        ANDROID_VR,
        ANDROID_VR_1_43_32,
        ANDROID_VR_NO_AUTH,
        IOS,
        IPADOS,
    ] {
        assert!(
            client.user_agent.contains(client.version),
            "{} v{} has a User-Agent that names a different build: {}",
            client.name,
            client.version,
            client.user_agent
        );
    }
}

#[test]
fn client_version_is_never_the_client_id() {
    for client in [WEB, WEB_REMIX, ANDROID, VISIONOS, IOS] {
        assert_ne!(
            client.version, client.client_id,
            "{} is sending its client id in the version field",
            client.name
        );
    }
    assert_eq!(WEB_REMIX.client_id, "67");
    assert!(WEB_REMIX.version.starts_with("1.2026"));
}

#[test]
fn lookup_resolves_the_names_media_urls_carry() {
    // The media proxy resolves a fetch User-Agent from a googlevideo URL's `c=`
    // parameter through this lookup, so every client that can mint one must
    // resolve — case-insensitively, because `c=` casing is not guaranteed.
    for client in [VISIONOS, ANDROID, ANDROID_VR, IOS, WEB, WEB_REMIX] {
        let found = clients::by_name(client.name).expect(client.name);
        assert_eq!(found.client_id, client.client_id);
        let lowercased = clients::by_name(&client.name.to_lowercase()).expect(client.name);
        assert_eq!(lowercased.client_id, client.client_id);
    }
    assert!(clients::by_name("NOT_A_CLIENT").is_none());
}

#[test]
fn client_ids_parse_for_the_sabr_streamer_context() {
    assert_eq!(VISIONOS.client_name_id(), 101);
    assert_eq!(WEB.client_name_id(), 1);
    assert_eq!(ANDROID_VR.client_name_id(), 28);
    assert_eq!(IOS.client_name_id(), 5);
}

#[test]
fn signature_timestamp_is_sent_only_where_the_client_asks_for_it() {
    assert!(
        VISIONOS.signature_timestamp().is_none(),
        "VISIONOS serves un-signed URLs; sending a timestamp is a fingerprint mismatch"
    );
    assert!(ANDROID_VR.signature_timestamp().is_none());
    assert_eq!(
        IOS.signature_timestamp(),
        Some(clients::DEFAULT_SIGNATURE_TIMESTAMP)
    );
}

#[test]
fn direct_audio_chain_leads_with_the_token_free_client() {
    assert_eq!(
        DIRECT_AUDIO_CLIENTS.first().map(|client| client.name),
        Some(VISIONOS.name),
        "VISIONOS is the only direct client served past the first minute unattested"
    );
}

#[test]
fn direct_audio_chain_excludes_the_sabr_only_iphone_clients() {
    // IOS and IPADOS return SABR-only responses with no direct URLs, so every
    // attempt was a wasted round trip — and they were the two clients being handed
    // a BotGuard token that iOSGuard cannot validate.
    assert!(
        !DIRECT_AUDIO_CLIENTS
            .iter()
            .any(|client| client.name == "IOS"),
        "IOS/IPADOS serve no direct audio URLs and must not be in the audio chain"
    );
}

#[test]
fn direct_audio_chain_ends_with_the_age_gate_bypass() {
    assert_eq!(
        DIRECT_AUDIO_CLIENTS.last().map(|client| client.name),
        Some(TVHTML5_SIMPLY_EMBEDDED_PLAYER.name),
        "the embedded player is the last resort, not a default"
    );
}

#[test]
fn context_carries_visitor_data_and_region_when_given() {
    let context = ANDROID.context(Some("visitor-token"), Some("DE"));
    assert_eq!(context["client"]["visitorData"], "visitor-token");
    assert_eq!(context["client"]["gl"], "DE");
    assert_eq!(context["client"]["clientName"], "ANDROID");
    assert_eq!(context["client"]["androidSdkVersion"], "34");

    let default_region = ANDROID.context(None, None);
    assert_eq!(default_region["client"]["gl"], "US");
    assert!(default_region["client"].get("visitorData").is_none());
}
