import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getLocalMediaLibrary: vi.fn(),
  onLocalScanStatus: vi.fn(() => Promise.resolve(() => {})),
  addLocalMediaFolder: vi.fn(),
  removeLocalMediaFolder: vi.fn(),
  excludeLocalMediaFolder: vi.fn(),
  rescanLocalMedia: vi.fn(() => Promise.resolve()),
  cancelLocalMediaScan: vi.fn(() => Promise.resolve()),
  saveLocalPlayback: vi.fn(() => Promise.resolve()),
  trashLocalFile: vi.fn(() => Promise.resolve()),
}));
vi.mock("../lib/api/localMedia", () => api);

import { useLocalMediaStore } from "./useLocalMediaStore";
import { useUiStore } from "./useUiStore";

const emptyLibrary = {
  folders: [],
  files: [],
  plays: [],
  scan: { running: false, done: 0, total: 0, truncated: false, failed: false },
};

const file = (id: string, folderPath: string) => ({ id, folderPath }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  api.getLocalMediaLibrary.mockResolvedValue(emptyLibrary);
  useLocalMediaStore.setState({ files: [], folders: [], plays: new Map(), loaded: false, loadError: false });
});

describe("useLocalMediaStore", () => {
  it("reports a failed read as an error, not an empty library", async () => {
    api.getLocalMediaLibrary.mockRejectedValue(new Error("no"));
    await useLocalMediaStore.getState().load();
    expect(useLocalMediaStore.getState().loadError).toBe(true);
  });

  it("hides an excluded folder at once and brings it back if the backend refuses", async () => {
    useLocalMediaStore.setState({ files: [file("a", "/m/hide"), file("b", "/m/hide/deep"), file("c", "/m/keep")] });
    api.excludeLocalMediaFolder.mockRejectedValueOnce(new Error("no"));
    const pending = useLocalMediaStore.getState().excludeFolder("/m/hide");
    expect(useLocalMediaStore.getState().files.map((item) => item.id)).toEqual(["c"]);
    await expect(pending).rejects.toThrow("no");
    expect(useLocalMediaStore.getState().files).toHaveLength(3);
  });

  it("takes a trashed file off the list at once and brings it back if the system refuses", async () => {
    useLocalMediaStore.setState({ files: [file("a", "/m"), file("b", "/m")] });
    api.trashLocalFile.mockRejectedValueOnce(new Error("no"));
    const pending = useLocalMediaStore.getState().trashFile("a");
    expect(useLocalMediaStore.getState().files.map((item) => item.id)).toEqual(["b"]);
    await expect(pending).rejects.toThrow("no");
    expect(useLocalMediaStore.getState().files).toHaveLength(2);

    await useLocalMediaStore.getState().trashFile("a");
    expect(useLocalMediaStore.getState().files.map((item) => item.id)).toEqual(["b"]);
  });

  it("says why a chosen folder was refused", async () => {
    const showToast = vi.fn();
    useUiStore.setState({ showToast });
    api.addLocalMediaFolder.mockRejectedValue({ kind: "validation", message: "Choose a folder inside the drive" });
    await useLocalMediaStore.getState().addFolder("title", false);
    expect(showToast).toHaveBeenCalledWith({ variant: "error", message: "Choose a folder inside the drive" });
  });

  it("does nothing when the folder picker is cancelled", async () => {
    api.addLocalMediaFolder.mockResolvedValue(null);
    await useLocalMediaStore.getState().addFolder("title", false);
    expect(api.getLocalMediaLibrary).not.toHaveBeenCalled();
  });

  it("shows a played position at once and undoes it if saving fails", async () => {
    api.saveLocalPlayback.mockRejectedValueOnce(new Error("no"));
    useLocalMediaStore.getState().notePlayback("a", 5, 10);
    expect(useLocalMediaStore.getState().plays.get("a")?.positionMs).toBe(5000);
    await vi.waitFor(() => expect(useLocalMediaStore.getState().plays.has("a")).toBe(false));
  });
});
