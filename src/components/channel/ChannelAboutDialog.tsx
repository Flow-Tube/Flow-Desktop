import { useEffect } from "react";
import { Calendar, Eye, Globe, Link2, Loader2, PlaySquare, Users, X } from "lucide-react";
import { LinkedText } from "../watch/LinkedText";
import { getString } from "../../lib/i18n/index";
import { openExternal } from "../../lib/openExternal";
import { useChannelAbout } from "../../lib/useChannelPage";
import { useProxiedImageUrl } from "../../lib/useProxiedImageUrl";
import type { ChannelDetails, ChannelLink } from "../../types/video";

interface ChannelAboutDialogProps {
  channel: ChannelDetails;
  open: boolean;
  onClose: () => void;
}

function LinkRow({ link }: { link: ChannelLink }) {
  const icon = useProxiedImageUrl(link.iconUrl);
  return (
    <button
      type="button"
      onClick={() => void openExternal(link.url)}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-container-high"
    >
      {icon ? (
        <img src={icon} alt="" className="h-5 w-5 shrink-0 rounded" />
      ) : (
        <Link2 size={18} className="shrink-0 text-chrome-neutral-500" />
      )}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-chrome-neutral-100">{link.title}</span>
        <span className="block truncate text-xs text-[var(--color-primary)]">{link.url}</span>
      </span>
    </button>
  );
}

/** The About panel: the full description, links and the channel's figures. */
export function ChannelAboutDialog({ channel, open, onClose }: ChannelAboutDialogProps) {
  const { about, loading, failed } = useChannelAbout(channel.aboutToken, open);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const description = about?.description ?? channel.description;
  const facts = about
    ? [
        { icon: Link2, text: about.canonicalUrl },
        { icon: Users, text: about.subscriberCountText },
        { icon: PlaySquare, text: about.videoCountText },
        { icon: Eye, text: about.viewCountText },
        { icon: Calendar, text: about.joinedDateText },
        { icon: Globe, text: about.countryText },
      ].filter((fact): fact is { icon: typeof Link2; text: string } => !!fact.text)
    : [];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-chrome-black/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="channel-about-title"
        onClick={(event) => event.stopPropagation()}
        className="animate-fade-in flex max-h-[min(720px,calc(100vh-4rem))] w-full max-w-lg flex-col rounded-2xl border border-chrome-neutral-800 bg-surface-container"
      >
        <div className="flex items-center justify-between border-b border-chrome-neutral-800 px-6 py-4">
          <h2 id="channel-about-title" className="text-lg font-bold tracking-tight text-chrome-neutral-100">
            {getString("about")}
          </h2>
          <button
            type="button"
            aria-label={getString("close")}
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-chrome-neutral-400 transition-colors hover:bg-surface-container-high hover:text-chrome-neutral-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="hide-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {description && (
            <LinkedText
              text={description}
              className="whitespace-pre-wrap text-sm leading-relaxed text-chrome-neutral-300"
            />
          )}

          {loading && (
            <div className="flex justify-center py-4">
              <Loader2 className="animate-spin text-[var(--color-primary)]" size={24} />
            </div>
          )}
          {failed && <p className="text-sm text-chrome-neutral-500">{getString("channel_about_error")}</p>}

          {about && about.links.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-chrome-neutral-200">{getString("channel_about_links")}</h3>
              <div className="-mx-2">
                {about.links.map((link) => (
                  <LinkRow key={link.url} link={link} />
                ))}
              </div>
            </section>
          )}

          {facts.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-chrome-neutral-200">
                {getString("channel_about_details")}
              </h3>
              <ul className="space-y-2.5">
                {facts.map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-3 text-sm text-chrome-neutral-300">
                    <Icon size={18} className="shrink-0 text-chrome-neutral-500" />
                    <span className="min-w-0 break-words">{text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
