import { useEffect, useMemo, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { ColorSwatchPicker } from "../ui/ColorSwatchPicker";
import { EmojiPicker } from "../ui/EmojiPicker";
import { ProfileAvatar } from "../ui/ProfileAvatar";
import { SegmentedControl } from "../ui/SegmentedControl";
import { TextInput } from "../ui/TextInput";
import { PROFILE_COLOR_KEYS, PROFILE_NAME_MAX_LENGTH, type Profile } from "../../lib/api/profiles";
import { pickFile } from "../../lib/dialogs";
import { getString, type StringKey } from "../../lib/i18n/index";
import { profileDisplayName } from "../../lib/profiles/display";
import { profileErrorMessage } from "../../lib/profiles/profileErrors";
import { useProfilesStore, type CopyChoice } from "../../store/useProfilesStore";
import { useUiStore } from "../../store/useUiStore";

// Android's set (strings.xml `profiles_emoji`).
const EMOJI = ["🎧", "📚", "🎮", "🍳", "⚽", "🌙", "🎬", "🎨", "🐶", "🌱"] as const;

type AvatarKind = "initial" | "emoji" | "photo";
type Start = "fresh" | "copy";

const COLOR_LABELS = Object.fromEntries(
  PROFILE_COLOR_KEYS.map((key) => [key, getString(`profiles_color_${key}` as StringKey)]),
);

function nameIssue(name: string, others: Profile[], blankAllowed: boolean): StringKey | null {
  const trimmed = name.trim();
  if (!trimmed && !blankAllowed) return "profiles_name_blank";
  if (trimmed.length > PROFILE_NAME_MAX_LENGTH) return "profiles_name_too_long";
  const wanted = (trimmed || getString("profiles_default_name")).toLocaleLowerCase();
  if (others.some((profile) => profileDisplayName(profile).toLocaleLowerCase() === wanted)) return "profiles_name_taken";
  return null;
}

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export interface ProfileEditorDialogProps {
  /** The profile to edit; absent to create one. */
  profile?: Profile;
  onClose: () => void;
}

export function ProfileEditorDialog({ profile, onClose }: ProfileEditorDialogProps) {
  const view = useProfilesStore((state) => state.view);
  const create = useProfilesStore((state) => state.create);
  const rename = useProfilesStore((state) => state.rename);
  const setLook = useProfilesStore((state) => state.setLook);
  const setPhoto = useProfilesStore((state) => state.setPhoto);
  const switchTo = useProfilesStore((state) => state.switchTo);
  const showToast = useUiStore((state) => state.showToast);

  const isDefault = profile !== undefined && profile.id === view?.defaultId;
  const current = view?.profiles.find((item) => item.id === view.activeId);
  const others = useMemo(() => view?.profiles.filter((item) => item.id !== profile?.id) ?? [], [view, profile]);

  const [name, setName] = useState(profile?.name ?? "");
  const [colorKey, setColorKey] = useState(profile?.colorKey || "blue");
  const [kind, setKind] = useState<AvatarKind>((profile?.avatar.kind as AvatarKind) ?? "initial");
  const [emoji, setEmoji] = useState(profile?.avatar.emoji || EMOJI[0]);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [start, setStart] = useState<Start>("fresh");
  const [copy, setCopy] = useState<CopyChoice>({ settings: true, subscriptions: true, recommendations: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const issue = nameIssue(name, others, isDefault);
  const existingPhoto = profile && kind === "photo" ? view?.photos[profile.id] : undefined;
  const needsPhoto = kind === "photo" && !photoPath && !existingPhoto;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const choosePhoto = async () => {
    const path = await pickFile(getString("profiles_photo_dialog_title"), [
      { name: getString("profiles_photo_filter"), extensions: ["png", "jpg", "jpeg", "webp"] },
    ]);
    if (path) setPhotoPath(path);
  };

  const avatar = { kind: kind === "photo" && !existingPhoto ? "initial" : kind, emoji: kind === "emoji" ? emoji : "", photoVersion: 0 };

  const submit = async () => {
    setTouched(true);
    if (issue || needsPhoto || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (profile) {
        if (name.trim() !== profile.name) await rename(profile.id, name);
        await setLook(profile.id, colorKey, avatar);
        if (photoPath) await setPhoto(profile.id, photoPath);
      } else {
        const choice = start === "copy" ? copy : { settings: false, subscriptions: false, recommendations: false };
        const created = await create({ name, colorKey, avatar }, choice);
        if (photoPath) {
          await setPhoto(created.id, photoPath).catch(() =>
            showToast({ message: getString("profiles_photo_failed"), variant: "error" }),
          );
        }
        showToast({
          message: getString("profiles_created", profileDisplayName(created)),
          variant: "success",
          actions: [{ label: getString("profiles_switch"), onSelect: () => void switchTo(created).catch(() => undefined) }],
        });
      }
      onClose();
    } catch (reason) {
      setError(profileErrorMessage(reason, profile ? "profiles_save_failed" : "profiles_create_failed"));
      setBusy(false);
    }
  };

  const previewName = name.trim() || (isDefault ? getString("profiles_default_name") : "");

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-chrome-black/70 p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-editor-title"
        onClick={(event) => event.stopPropagation()}
        className="animate-fade-in flex max-h-[90vh] w-full max-w-lg flex-col gap-5 overflow-y-auto rounded-2xl border border-chrome-neutral-800 bg-surface-container p-6"
      >
        <div className="flex items-center gap-4">
          <ProfileAvatar
            name={previewName}
            colorKey={colorKey}
            kind={kind}
            emoji={emoji}
            photoSrc={existingPhoto}
            size="xl"
          />
          <h2 id="profile-editor-title" className="text-lg font-bold tracking-tight text-chrome-neutral-100">
            {getString(profile ? "profiles_edit_title" : "profiles_new_title")}
          </h2>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-chrome-neutral-400">{getString("profiles_name")}</span>
          <TextInput
            value={name}
            onChange={setName}
            onBlur={() => setTouched(true)}
            maxLength={PROFILE_NAME_MAX_LENGTH}
            autoFocus
            aria-invalid={touched && issue !== null}
            className="py-2"
          />
          <span className="flex justify-between text-xs">
            <span className="text-chrome-red-400">{touched && issue ? getString(issue) : ""}</span>
            <span className="font-mono text-chrome-neutral-500">
              {name.length}/{PROFILE_NAME_MAX_LENGTH}
            </span>
          </span>
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm text-chrome-neutral-400">{getString("profiles_color")}</span>
          <ColorSwatchPicker
            value={colorKey}
            options={PROFILE_COLOR_KEYS}
            labels={COLOR_LABELS}
            ariaLabel={getString("profiles_color")}
            onChange={setColorKey}
          />
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm text-chrome-neutral-400">{getString("profiles_avatar")}</span>
          <SegmentedControl<AvatarKind>
            value={kind}
            onChange={setKind}
            label={getString("profiles_avatar")}
            options={[
              { value: "initial", label: getString("profiles_avatar_initial") },
              { value: "emoji", label: getString("profiles_avatar_emoji") },
              { value: "photo", label: getString("profiles_avatar_photo") },
            ]}
          />
          {kind === "emoji" && (
            <EmojiPicker value={emoji} options={EMOJI} ariaLabel={getString("profiles_avatar_emoji")} onChange={setEmoji} />
          )}
          {kind === "photo" && (
            <div className="flex items-center gap-3">
              <Button variant="tonal" onClick={() => void choosePhoto()}>
                <ImagePlus className="h-4 w-4" />
                {getString(photoPath || existingPhoto ? "profiles_change_photo" : "profiles_choose_photo")}
              </Button>
              {photoPath && (
                <span className="truncate text-xs text-chrome-neutral-400">
                  {getString("profiles_photo_chosen", fileName(photoPath))}
                </span>
              )}
            </div>
          )}
        </div>

        {!profile && current && (
          <div className="flex flex-col gap-3">
            <span className="text-sm text-chrome-neutral-400">{getString("profiles_start")}</span>
            <SegmentedControl<Start>
              value={start}
              onChange={setStart}
              label={getString("profiles_start")}
              options={[
                { value: "fresh", label: getString("profiles_start_fresh") },
                { value: "copy", label: getString("profiles_copy_from", profileDisplayName(current)) },
              ]}
            />
            {start === "fresh" ? (
              <p className="text-xs text-chrome-neutral-400">{getString("profiles_start_fresh_desc")}</p>
            ) : (
              <div className="flex flex-col gap-3 rounded-lg border border-chrome-neutral-800 bg-surface-container-low p-3">
                {(["settings", "subscriptions", "recommendations"] as const).map((part) => (
                  <Checkbox key={part} checked={copy[part]} onChange={(checked) => setCopy({ ...copy, [part]: checked })}>
                    <span className="flex flex-col">
                      <span className="text-sm text-chrome-neutral-200">{getString(`profiles_copy_${part}`)}</span>
                      <span className="text-xs text-chrome-neutral-400">{getString(`profiles_copy_${part}_desc`)}</span>
                    </span>
                  </Checkbox>
                ))}
              </div>
            )}
            <p className="text-xs text-chrome-neutral-500">{getString("profiles_copy_note")}</p>
          </div>
        )}

        {error && <p className="text-sm text-chrome-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {getString("profiles_cancel")}
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || (touched && (issue !== null || needsPhoto))}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {getString(profile ? "profiles_save" : "profiles_create")}
          </Button>
        </div>
      </div>
    </div>
  );
}
