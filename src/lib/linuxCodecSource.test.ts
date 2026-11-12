import { describe, expect, it } from "vitest";
import strings from "./i18n/strings.json";
import { CODEC_INSTALL_STEPS, LINUX_CODEC_SOURCES, toLinuxCodecSource } from "./linuxCodecSource";

describe("linuxCodecSource", () => {
  it("has steps with a real string for every source", () => {
    for (const source of LINUX_CODEC_SOURCES) {
      expect(strings).toHaveProperty(CODEC_INSTALL_STEPS[source].hint);
    }
  });

  it("gives Fedora the RPM Fusion route, not the package Fedora 44 doesn't have", () => {
    const commands = CODEC_INSTALL_STEPS.dnf.commands.join("\n");
    expect(commands).toContain("gstreamer1-plugin-libav");
    expect(commands).not.toContain("gstreamer1-libav");
  });

  it("reads an unknown answer as other", () => {
    expect(toLinuxCodecSource("dnf")).toBe("dnf");
    expect(toLinuxCodecSource("zypper")).toBe("other");
    expect(toLinuxCodecSource(undefined)).toBe("other");
  });
});
