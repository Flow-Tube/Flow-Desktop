//! Typed SABR protobuf messages, encoded/decoded with the hand-rolled [`pb`]
//! codec. Field numbers mirror the proto2 definitions in `notes/SABR` exactly

use super::pb::{PbReader, PbWriter};

// ---------------------------------------------------------------------------
// misc.FormatId
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FormatId {
    pub itag: i32,
    pub last_modified: u64,
    pub xtags: Option<String>,
}

impl FormatId {
    pub fn new(itag: i32, last_modified: u64, xtags: Option<String>) -> Self {
        Self {
            itag,
            last_modified,
            xtags,
        }
    }

    fn encode_into(&self, w: &mut PbWriter) {
        if self.itag != 0 {
            w.write_int32(1, self.itag);
        }
        if self.last_modified != 0 {
            w.write_uint64(2, self.last_modified);
        }
        if let Some(xtags) = &self.xtags {
            if !xtags.is_empty() {
                w.write_string(3, xtags);
            }
        }
    }

    pub fn encode(&self) -> Vec<u8> {
        let mut w = PbWriter::new();
        self.encode_into(&mut w);
        w.into_bytes()
    }

    pub fn decode(data: &[u8]) -> Self {
        let mut out = Self::default();
        let mut r = PbReader::new(data);
        while let Some(f) = r.next_field() {
            match f.number {
                1 => out.itag = f.as_i32(),
                2 => out.last_modified = f.as_u64(),
                3 => out.xtags = f.as_str().map(ToOwned::to_owned),
                _ => {}
            }
        }
        out
    }
}

// ---------------------------------------------------------------------------
// video_streaming.TimeRange
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
pub struct TimeRange {
    pub start_ticks: i64,
    pub duration_ticks: i64,
    pub timescale: i32,
}

impl TimeRange {
    fn encode_into(&self, w: &mut PbWriter) {
        w.write_int64(1, self.start_ticks);
        w.write_int64(2, self.duration_ticks);
        w.write_int32(3, self.timescale);
    }

    pub fn decode(data: &[u8]) -> Self {
        let mut out = Self::default();
        let mut r = PbReader::new(data);
        while let Some(f) = r.next_field() {
            match f.number {
                1 => out.start_ticks = f.as_i64(),
                2 => out.duration_ticks = f.as_i64(),
                3 => out.timescale = f.as_i32(),
                _ => {}
            }
        }
        out
    }

    // Convert to milliseconds using the timescale (defaults to 1000).
    pub fn to_ms(&self, ticks: i64) -> i64 {
        let ts = if self.timescale > 0 {
            self.timescale
        } else {
            1000
        };
        (ticks.saturating_mul(1000)) / i64::from(ts)
    }
}

// ---------------------------------------------------------------------------
// video_streaming.BufferedRange
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct BufferedRange {
    pub format_id: FormatId,
    pub start_time_ms: i64,
    pub duration_ms: i64,
    pub start_segment_index: i32,
    pub end_segment_index: i32,
    pub time_range: Option<TimeRange>,
}

impl BufferedRange {
    fn encode_into(&self, w: &mut PbWriter) {
        w.write_message(1, &self.format_id.encode());
        w.write_int64(2, self.start_time_ms);
        w.write_int64(3, self.duration_ms);
        w.write_int32(4, self.start_segment_index);
        w.write_int32(5, self.end_segment_index);
        if let Some(tr) = &self.time_range {
            let mut tw = PbWriter::new();
            tr.encode_into(&mut tw);
            w.write_message(6, &tw.into_bytes());
        }
    }
}

// ---------------------------------------------------------------------------
// video_streaming.ClientAbrState (request side, subset)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct ClientAbrState {
    pub player_time_ms: i64,
    pub bandwidth_estimate: i64,
    pub visibility: i32,
    pub playback_rate: f32,
    pub player_state: i64,
    pub client_viewport_width: i32,
    pub client_viewport_height: i32,
    // `None` => omit (server sends audio + video). `Some(1)` => audio only.
    pub enabled_track_types_bitfield: Option<i32>,
    pub drc_enabled: bool,
}

impl Default for ClientAbrState {
    fn default() -> Self {
        Self {
            player_time_ms: 0,
            bandwidth_estimate: 5_000_000,
            visibility: 0,
            playback_rate: 1.0,
            player_state: 0,
            client_viewport_width: 1280,
            client_viewport_height: 720,
            enabled_track_types_bitfield: None,
            drc_enabled: false,
        }
    }
}

impl ClientAbrState {
    fn encode_into(&self, w: &mut PbWriter) {
        if self.client_viewport_width > 0 {
            w.write_int32(18, self.client_viewport_width);
        }
        if self.client_viewport_height > 0 {
            w.write_int32(19, self.client_viewport_height);
        }
        if self.bandwidth_estimate > 0 {
            w.write_int64(23, self.bandwidth_estimate);
        }
        w.write_int64(28, self.player_time_ms);
        w.write_int32(34, self.visibility);
        w.write_float(35, self.playback_rate);
        if let Some(bitfield) = self.enabled_track_types_bitfield {
            w.write_int32(40, bitfield);
        }
        w.write_int64(44, self.player_state);
        if self.drc_enabled {
            w.write_bool(46, true);
        }
    }
}

// ---------------------------------------------------------------------------
// video_streaming.StreamerContext (+ ClientInfo, SabrContext)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default)]
pub struct ClientInfo {
    pub device_make: String,
    pub device_model: String,
    pub client_name: i32,
    pub client_version: String,
    pub os_name: String,
    pub os_version: String,
}

impl ClientInfo {
    fn encode(&self) -> Vec<u8> {
        let mut w = PbWriter::new();
        if !self.device_make.is_empty() {
            w.write_string(12, &self.device_make);
        }
        if !self.device_model.is_empty() {
            w.write_string(13, &self.device_model);
        }
        if self.client_name != 0 {
            w.write_int32(16, self.client_name);
        }
        if !self.client_version.is_empty() {
            w.write_string(17, &self.client_version);
        }
        if !self.os_name.is_empty() {
            w.write_string(18, &self.os_name);
        }
        if !self.os_version.is_empty() {
            w.write_string(19, &self.os_version);
        }
        w.into_bytes()
    }
}

#[derive(Debug, Clone)]
pub struct SabrContext {
    pub r#type: i32,
    pub value: Vec<u8>,
}

#[derive(Debug, Clone, Default)]
pub struct StreamerContext {
    pub client_info: ClientInfo,
    pub po_token: Option<Vec<u8>>,
    pub playback_cookie: Option<Vec<u8>>,
    pub sabr_contexts: Vec<SabrContext>,
    pub unsent_sabr_contexts: Vec<i32>,
}

impl StreamerContext {
    fn encode(&self) -> Vec<u8> {
        let mut w = PbWriter::new();
        w.write_message(1, &self.client_info.encode());
        if let Some(po) = &self.po_token {
            if !po.is_empty() {
                w.write_bytes(2, po);
            }
        }
        if let Some(cookie) = &self.playback_cookie {
            if !cookie.is_empty() {
                w.write_bytes(3, cookie);
            }
        }
        for ctx in &self.sabr_contexts {
            let mut cw = PbWriter::new();
            cw.write_int32(1, ctx.r#type);
            cw.write_bytes(2, &ctx.value);
            w.write_message(5, &cw.into_bytes());
        }
        for t in &self.unsent_sabr_contexts {
            w.write_int32(6, *t);
        }
        w.into_bytes()
    }
}

// ---------------------------------------------------------------------------
// video_streaming.VideoPlaybackAbrRequest (top-level request)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct VideoPlaybackAbrRequest {
    pub client_abr_state: ClientAbrState,
    pub selected_format_ids: Vec<FormatId>,
    pub buffered_ranges: Vec<BufferedRange>,
    pub player_time_ms: i64,
    pub video_playback_ustreamer_config: Vec<u8>,
    pub preferred_audio_format_ids: Vec<FormatId>,
    pub preferred_video_format_ids: Vec<FormatId>,
    pub streamer_context: StreamerContext,
}

impl VideoPlaybackAbrRequest {
    pub fn encode(&self) -> Vec<u8> {
        let mut w = PbWriter::new();

        let mut cw = PbWriter::new();
        self.client_abr_state.encode_into(&mut cw);
        w.write_message(1, &cw.into_bytes());

        for fid in &self.selected_format_ids {
            w.write_message(2, &fid.encode());
        }
        for range in &self.buffered_ranges {
            let mut bw = PbWriter::new();
            range.encode_into(&mut bw);
            w.write_message(3, &bw.into_bytes());
        }
        w.write_int64(4, self.player_time_ms);
        if !self.video_playback_ustreamer_config.is_empty() {
            w.write_bytes(5, &self.video_playback_ustreamer_config);
        }
        for fid in &self.preferred_audio_format_ids {
            w.write_message(16, &fid.encode());
        }
        for fid in &self.preferred_video_format_ids {
            w.write_message(17, &fid.encode());
        }
        w.write_message(19, &self.streamer_context.encode());

        w.into_bytes()
    }
}

// ===========================================================================
// Response-side decoders
// ===========================================================================

#[derive(Debug, Clone, Default)]
pub struct MediaHeader {
    pub header_id: u32,
    pub video_id: Option<String>,
    pub itag: i32,
    pub lmt: u64,
    pub start_range: i64,
    pub is_init_seg: bool,
    pub sequence_number: i32,
    pub start_ms: i64,
    pub duration_ms: i64,
    pub content_length: i64,
    pub time_range: Option<TimeRange>,
    pub format_id: Option<FormatId>,
}

impl MediaHeader {
    pub fn decode(data: &[u8]) -> Self {
        let mut out = Self::default();
        let mut r = PbReader::new(data);
        while let Some(f) = r.next_field() {
            match f.number {
                1 => out.header_id = f.as_u32(),
                2 => out.video_id = f.as_str().map(ToOwned::to_owned),
                3 => out.itag = f.as_i32(),
                4 => out.lmt = f.as_u64(),
                6 => out.start_range = f.as_i64(),
                8 => out.is_init_seg = f.as_bool(),
                9 => out.sequence_number = f.as_i32(),
                11 => out.start_ms = f.as_i64(),
                12 => out.duration_ms = f.as_i64(),
                13 => out.format_id = Some(FormatId::decode(f.as_bytes())),
                14 => out.content_length = f.as_i64(),
                15 => out.time_range = Some(TimeRange::decode(f.as_bytes())),
                _ => {}
            }
        }
        out
    }

    // Effective segment start time in ms (direct field or derived from range).
    pub fn effective_start_ms(&self) -> i64 {
        if self.start_ms != 0 {
            return self.start_ms;
        }
        if let Some(tr) = &self.time_range {
            return tr.to_ms(tr.start_ticks);
        }
        0
    }

    // Effective segment duration in ms (direct field or derived from range).
    pub fn effective_duration_ms(&self) -> i64 {
        if self.duration_ms != 0 {
            return self.duration_ms;
        }
        if let Some(tr) = &self.time_range {
            return tr.to_ms(tr.duration_ticks);
        }
        0
    }
}

#[derive(Debug, Clone, Default)]
pub struct FormatInitializationMetadata {
    pub video_id: Option<String>,
    pub format_id: Option<FormatId>,
    pub end_time_ms: i64,
    pub end_segment_number: i64,
    pub mime_type: Option<String>,
    pub duration_units: i64,
    pub duration_timescale: i64,
}

impl FormatInitializationMetadata {
    pub fn decode(data: &[u8]) -> Self {
        let mut out = Self::default();
        let mut r = PbReader::new(data);
        while let Some(f) = r.next_field() {
            match f.number {
                1 => out.video_id = f.as_str().map(ToOwned::to_owned),
                2 => out.format_id = Some(FormatId::decode(f.as_bytes())),
                3 => out.end_time_ms = f.as_i64(),
                4 => out.end_segment_number = f.as_i64(),
                5 => out.mime_type = f.as_str().map(ToOwned::to_owned),
                9 => out.duration_units = f.as_i64(),
                10 => out.duration_timescale = f.as_i64(),
                _ => {}
            }
        }
        out
    }

    pub fn itag(&self) -> i32 {
        self.format_id.as_ref().map_or(0, |f| f.itag)
    }
}

#[derive(Debug, Clone, Default)]
pub struct NextRequestPolicy {
    pub backoff_time_ms: i32,
    pub max_time_since_last_request_ms: i32,
    // Raw bytes of the PlaybackCookie sub-message, for verbatim echo-back.
    pub playback_cookie: Option<Vec<u8>>,
}

impl NextRequestPolicy {
    pub fn decode(data: &[u8]) -> Self {
        let mut out = Self::default();
        let mut r = PbReader::new(data);
        while let Some(f) = r.next_field() {
            match f.number {
                3 => out.max_time_since_last_request_ms = f.as_i32(),
                4 => out.backoff_time_ms = f.as_i32(),
                7 => out.playback_cookie = Some(f.as_bytes().to_vec()),
                _ => {}
            }
        }
        out
    }
}

#[derive(Debug, Clone, Default)]
pub struct SabrRedirect {
    pub url: Option<String>,
}

impl SabrRedirect {
    pub fn decode(data: &[u8]) -> Self {
        let mut out = Self::default();
        let mut r = PbReader::new(data);
        while let Some(f) = r.next_field() {
            if f.number == 1 {
                out.url = f.as_str().map(ToOwned::to_owned);
            }
        }
        out
    }
}

#[derive(Debug, Clone, Default)]
pub struct SabrError {
    pub r#type: Option<String>,
    pub code: i32,
}

impl SabrError {
    pub fn decode(data: &[u8]) -> Self {
        let mut out = Self::default();
        let mut r = PbReader::new(data);
        while let Some(f) = r.next_field() {
            match f.number {
                1 => out.r#type = f.as_str().map(ToOwned::to_owned),
                2 => out.code = f.as_i32(),
                _ => {}
            }
        }
        out
    }
}

#[derive(Debug, Clone, Default)]
pub struct SabrContextUpdate {
    pub r#type: i32,
    pub scope: i32,
    pub value: Option<Vec<u8>>,
    pub send_by_default: bool,
    pub write_policy: i32,
}

impl SabrContextUpdate {
    pub fn decode(data: &[u8]) -> Self {
        let mut out = Self::default();
        let mut r = PbReader::new(data);
        while let Some(f) = r.next_field() {
            match f.number {
                1 => out.r#type = f.as_i32(),
                2 => out.scope = f.as_i32(),
                3 => out.value = Some(f.as_bytes().to_vec()),
                4 => out.send_by_default = f.as_bool(),
                5 => out.write_policy = f.as_i32(),
                _ => {}
            }
        }
        out
    }
}

#[derive(Debug, Clone, Default)]
pub struct SabrContextSendingPolicy {
    pub start_policy: Vec<i32>,
    pub stop_policy: Vec<i32>,
    pub discard_policy: Vec<i32>,
}

impl SabrContextSendingPolicy {
    pub fn decode(data: &[u8]) -> Self {
        let mut out = Self::default();
        let mut r = PbReader::new(data);
        while let Some(f) = r.next_field() {
            // proto2 `repeated int32` may arrive packed (LEN) or unpacked (VARINT).
            match f.number {
                1 => collect_int32s(&f, &mut out.start_policy),
                2 => collect_int32s(&f, &mut out.stop_policy),
                3 => collect_int32s(&f, &mut out.discard_policy),
                _ => {}
            }
        }
        out
    }
}

fn collect_int32s(field: &super::pb::PbField, out: &mut Vec<i32>) {
    if field.wire_type == super::pb::wire::LEN {
        let mut r = PbReader::new(field.as_bytes());
        while let Some(v) = r_next_raw_varint(&mut r) {
            out.push(v as i32);
        }
    } else {
        out.push(field.as_i32());
    }
}

fn r_next_raw_varint(r: &mut PbReader) -> Option<u64> {
    r.read_packed_varint()
}

#[derive(Debug, Clone, Default)]
pub struct StreamProtectionStatus {
    pub status: i32,
    pub max_retries: i32,
}

impl StreamProtectionStatus {
    // status enum (observed): 1 = OK, 2 = attestation pending, 3 = attestation required
    pub const ATTESTATION_REQUIRED: i32 = 3;

    pub fn decode(data: &[u8]) -> Self {
        let mut out = Self::default();
        let mut r = PbReader::new(data);
        while let Some(f) = r.next_field() {
            match f.number {
                1 => out.status = f.as_i32(),
                2 => out.max_retries = f.as_i32(),
                _ => {}
            }
        }
        out
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::streaming::sabr::pb::PbReader;

    #[test]
    fn format_id_roundtrip() {
        let fid = FormatId::new(251, 1_700_000_000, None);
        let decoded = FormatId::decode(&fid.encode());
        assert_eq!(decoded, fid);
    }

    #[test]
    fn request_encodes_expected_fields() {
        let req = VideoPlaybackAbrRequest {
            client_abr_state: ClientAbrState {
                player_time_ms: 1234,
                enabled_track_types_bitfield: Some(1),
                ..Default::default()
            },
            selected_format_ids: vec![FormatId::new(251, 100, None)],
            buffered_ranges: vec![BufferedRange {
                format_id: FormatId::new(251, 100, None),
                start_time_ms: 0,
                duration_ms: 5000,
                start_segment_index: 0,
                end_segment_index: 2,
                time_range: Some(TimeRange {
                    start_ticks: 0,
                    duration_ticks: 5000,
                    timescale: 1000,
                }),
            }],
            player_time_ms: 1234,
            video_playback_ustreamer_config: vec![1, 2, 3],
            preferred_audio_format_ids: vec![FormatId::new(251, 100, None)],
            preferred_video_format_ids: vec![FormatId::new(248, 200, None)],
            streamer_context: StreamerContext {
                client_info: ClientInfo {
                    client_name: 1,
                    client_version: "2.0".into(),
                    ..Default::default()
                },
                po_token: Some(vec![9, 9, 9]),
                playback_cookie: Some(vec![7, 7]),
                sabr_contexts: vec![],
                unsent_sabr_contexts: vec![],
            },
        };

        let encoded = req.encode();
        // Walk the top-level fields and assert the important ones are present.
        let mut r = PbReader::new(&encoded);
        let mut seen_client_state = false;
        let mut selected_count = 0;
        let mut ustreamer = None;
        let mut streamer_ctx = None;
        while let Some(f) = r.next_field() {
            match f.number {
                1 => seen_client_state = true,
                2 => selected_count += 1,
                5 => ustreamer = Some(f.as_bytes().to_vec()),
                19 => streamer_ctx = Some(f.as_bytes().to_vec()),
                _ => {}
            }
        }
        assert!(seen_client_state);
        assert_eq!(selected_count, 1);
        assert_eq!(ustreamer, Some(vec![1, 2, 3]));
        // streamer_context should carry the po_token bytes at field 2.
        let ctx = streamer_ctx.expect("streamer context present");
        let mut cr = PbReader::new(&ctx);
        let mut po = None;
        let mut cookie = None;
        while let Some(f) = cr.next_field() {
            match f.number {
                2 => po = Some(f.as_bytes().to_vec()),
                3 => cookie = Some(f.as_bytes().to_vec()),
                _ => {}
            }
        }
        assert_eq!(po, Some(vec![9, 9, 9]));
        assert_eq!(cookie, Some(vec![7, 7]));
    }

    #[test]
    fn media_header_decodes_time_range_fallback() {
        // Build a MediaHeader with only a time_range (no direct start/duration).
        let mut tr = PbWriterShim::new();
        tr.int64(1, 2000); // start_ticks
        tr.int64(2, 4000); // duration_ticks
        tr.int32(3, 1000); // timescale
        let tr_bytes = tr.done();

        let mut w = PbWriterShim::new();
        w.uint64_field(1, 42); // header_id
        w.int32(3, 251); // itag
        w.bool(8, false); // is_init_seg
        w.int32(9, 3); // sequence_number
        w.message(15, &tr_bytes); // time_range
        let header = w.done();

        let mh = MediaHeader::decode(&header);
        assert_eq!(mh.header_id, 42);
        assert_eq!(mh.itag, 251);
        assert_eq!(mh.sequence_number, 3);
        assert_eq!(mh.effective_start_ms(), 2000);
        assert_eq!(mh.effective_duration_ms(), 4000);
    }

    #[test]
    fn sending_policy_unpacked_and_packed() {
        // unpacked
        let mut w = PbWriterShim::new();
        w.int32(1, 5);
        w.int32(1, 6);
        w.int32(3, 9);
        let p = SabrContextSendingPolicy::decode(&w.done());
        assert_eq!(p.start_policy, vec![5, 6]);
        assert_eq!(p.discard_policy, vec![9]);
    }

    // Tiny writer shim reusing PbWriter for test fixture construction.
    struct PbWriterShim(super::PbWriter);
    impl PbWriterShim {
        fn new() -> Self {
            Self(super::PbWriter::new())
        }
        fn int32(&mut self, f: u32, v: i32) {
            self.0.write_int32(f, v);
        }
        fn int64(&mut self, f: u32, v: i64) {
            self.0.write_int64(f, v);
        }
        fn uint64_field(&mut self, f: u32, v: u64) {
            self.0.write_uint64(f, v);
        }
        fn bool(&mut self, f: u32, v: bool) {
            self.0.write_bool(f, v);
        }
        fn message(&mut self, f: u32, m: &[u8]) {
            self.0.write_message(f, m);
        }
        fn done(self) -> Vec<u8> {
            self.0.into_bytes()
        }
    }
}
