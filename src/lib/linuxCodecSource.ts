import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { StringKey } from "./i18n/index";

/** How this Linux system installs video decoders; see src-tauri/src/linux_system.rs. */
export const LINUX_CODEC_SOURCES = ["apt", "dnf", "pacman", "appimage", "flatpak", "other"] as const;
export type LinuxCodecSource = (typeof LINUX_CODEC_SOURCES)[number];

export function toLinuxCodecSource(value: unknown): LinuxCodecSource {
  return LINUX_CODEC_SOURCES.find((source) => source === value) ?? "other";
}

export interface CodecInstallSteps {
  /** The line above the commands. */
  hint: StringKey;
  commands: string[];
}

/** What the no-picture banner tells this system to do. Each command follows its distribution's own docs. */
export const CODEC_INSTALL_STEPS: Record<LinuxCodecSource, CodecInstallSteps> = {
  apt: {
    hint: "player_codec_missing_command_hint",
    commands: [
      "sudo apt install gstreamer1.0-libav gstreamer1.0-plugins-bad gstreamer1.0-plugins-good gstreamer1.0-plugins-ugly",
    ],
  },
  // Fedora's ffmpeg-free has no H.264; RPM Fusion's ffmpeg gives gstreamer1-plugin-libav one (rpmfusion.org/Howto/Multimedia).
  dnf: {
    hint: "player_codec_missing_dnf_hint",
    commands: ["sudo dnf swap ffmpeg-free ffmpeg --allowerasing", "sudo dnf install gstreamer1-plugin-libav"],
  },
  pacman: {
    hint: "player_codec_missing_pacman_hint",
    commands: ["sudo pacman -S gst-libav gst-plugins-good"],
  },
  appimage: { hint: "player_codec_missing_bundled_hint", commands: [] },
  flatpak: { hint: "player_codec_missing_bundled_hint", commands: [] },
  other: { hint: "player_codec_missing_other_hint", commands: [] },
};

let cached: Promise<LinuxCodecSource> | null = null;

/** Read once per launch, and only after a banner needs it. */
export function useLinuxCodecSource(enabled: boolean): LinuxCodecSource | null {
  const [source, setSource] = useState<LinuxCodecSource | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    cached ??= invoke<string>("linux_codec_source")
      .then(toLinuxCodecSource)
      .catch(() => "other" as const);
    void cached.then((value) => {
      if (active) setSource(value);
    });
    return () => {
      active = false;
    };
  }, [enabled]);
  return source;
}
