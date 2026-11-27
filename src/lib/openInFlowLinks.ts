/** Where the Flow browser extension is downloaded. */
export const EXTENSION_RELEASES_URL = "https://github.com/Flow-Tube/Flow-Extension/releases/latest";

/**
 * A bookmark that sends the page it is clicked on to Flow, for Safari and other browsers
 * the extension doesn't run in. Flow decides what the page is, and ignores anything not YouTube.
 */
export const OPEN_IN_FLOW_BOOKMARKLET =
  "javascript:location.href='flow://open?url='+encodeURIComponent(location.href)";
