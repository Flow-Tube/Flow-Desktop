import { openExternal } from "./openExternal";

const parseTimestampToSeconds = (ts: string): number => {
  const parts = ts.split(":").map(Number);
  if (parts.length === 3) return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  if (parts.length === 2) return (parts[0] || 0) * 60 + (parts[1] || 0);
  return 0;
};

export const seekToTime = (seconds: number) => {
  window.dispatchEvent(new CustomEvent("flow-player-seek", { detail: { time: seconds } }));
};

export function linkifyText(text: string) {
  if (!text) return "";
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const timestampRegex = /\b((?:[0-9]{1,2}:)?[0-9]{1,2}:[0-9]{2})\b/g;

  return text.split(urlRegex).map((urlPart, i) => {
    if (urlPart.match(urlRegex)) {
      return (
        <a
          key={`url-${i}`}
          href={urlPart}
          target="_blank"
          rel="noopener noreferrer"
          className="cursor-pointer font-medium text-primary hover:underline"
          onClick={(e) => {
            // WebView2 swallows target="_blank" navigation; route through the opener plugin.
            e.preventDefault();
            e.stopPropagation();
            void openExternal(urlPart);
          }}
        >
          {urlPart}
        </a>
      );
    }

    return urlPart.split(timestampRegex).map((tsPart, j) => {
      if (tsPart.match(timestampRegex)) {
        const seconds = parseTimestampToSeconds(tsPart);
        return (
          <span
            key={`ts-${i}-${j}`}
            className="cursor-pointer font-medium text-primary hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              seekToTime(seconds);
            }}
          >
            {tsPart}
          </span>
        );
      }
      return tsPart;
    });
  });
}
