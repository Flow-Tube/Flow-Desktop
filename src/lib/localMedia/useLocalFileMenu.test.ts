import { beforeEach, describe, expect, it, vi } from "vitest";

const excludeLocalMediaFolder = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../api/localMedia", () => ({
  excludeLocalMediaFolder,
  getLocalMediaLibrary: vi.fn(async () => ({ folders: [], files: [], plays: [], scan: {} })),
  onLocalScanStatus: vi.fn(async () => () => {}),
  pickLocalSubtitle: vi.fn(),
}));

import { useLocalMediaStore } from "../../store/useLocalMediaStore";
import { useUiStore } from "../../store/useUiStore";
import { getString } from "../i18n/index";
import { localFileMenuActions } from "./useLocalFileMenu";

const hide = (folderPath: string) => {
  const file = { id: "local_1", kind: "audio", folderPath } as never;
  localFileMenuActions(file, { onDetails: () => {}, navigate: () => {} }).find((action) => action.id === "hide-folder")!.onSelect();
};

describe("hiding a file's folder", () => {
  beforeEach(() => {
    excludeLocalMediaFolder.mockClear();
    useUiStore.setState({ toast: null });
    useLocalMediaStore.setState({ folders: [{ path: "/music", role: "include", addedMs: 1 }] as never, files: [] });
  });

  it("leaves a folder you chose in the library and says why", () => {
    hide("/music");
    expect(excludeLocalMediaFolder).not.toHaveBeenCalled();
    expect(useUiStore.getState().toast?.message).toBe(getString("local_folder_hide_chosen"));
  });

  it("hides a folder inside one you chose", () => {
    hide("/music/album");
    expect(excludeLocalMediaFolder).toHaveBeenCalledWith("/music/album");
  });
});
