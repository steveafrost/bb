import { describe, expect, it } from "vitest";
import { BB_DESKTOP_APP_ICON_MAX_DATA_URL_LENGTH } from "@bb/desktop-contract";
import { createDesktopAppIconController } from "../src/desktop-app-icon.js";

interface FakeImage {
  id: string;
  isEmpty(): boolean;
}

function image(id: string, empty = false): FakeImage {
  return { id, isEmpty: () => empty };
}

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

function createHarness(platform: NodeJS.Platform) {
  const dockIcons: string[] = [];
  const windowIcons: string[] = [];
  const decoded: string[] = [];
  const window = {
    isDestroyed: () => false,
    setIcon: (icon: FakeImage) => windowIcons.push(icon.id),
  };
  const destroyedWindow = {
    isDestroyed: () => true,
    setIcon: () => {
      throw new Error("destroyed window must not be touched");
    },
  };
  const controller = createDesktopAppIconController<FakeImage>({
    platform,
    bundledIcon: image("bundled"),
    createImageFromDataUrl: (dataUrl) => {
      decoded.push(dataUrl);
      return dataUrl.endsWith("empty") ? image("empty", true) : image("custom");
    },
    setDockIcon: (icon) => dockIcons.push(icon.id),
    listWindows: () => [window, destroyedWindow],
  });
  return { controller, decoded, dockIcons, windowIcons };
}

describe("desktop app icon controller", () => {
  it("sets the macOS Dock icon and restores the bundled icon on reset", () => {
    const { controller, dockIcons, windowIcons } = createHarness("darwin");

    controller.handleMessage({ pngDataUrl: PNG_DATA_URL });
    controller.handleMessage(null);

    expect(dockIcons).toEqual(["custom", "bundled"]);
    expect(windowIcons).toEqual([]);
  });

  it("leaves the bundled icon alone when no custom icon was ever applied", () => {
    const { controller, dockIcons } = createHarness("darwin");

    controller.handleMessage(null);

    expect(dockIcons).toEqual([]);
  });

  it("sets live window icons on Windows and Linux, including new windows", () => {
    for (const platform of ["win32", "linux"] as const) {
      const { controller, dockIcons, windowIcons } = createHarness(platform);
      const lateWindow = {
        isDestroyed: () => false,
        setIcon: (icon: FakeImage) => windowIcons.push(`late:${icon.id}`),
      };

      controller.applyToNewWindow(lateWindow);
      controller.handleMessage({ pngDataUrl: PNG_DATA_URL });
      controller.applyToNewWindow(lateWindow);
      controller.handleMessage(null);
      controller.applyToNewWindow(lateWindow);

      expect(dockIcons).toEqual([]);
      expect(windowIcons).toEqual(["custom", "late:custom", "bundled"]);
    }
  });

  it.each([
    [
      "a non-PNG data URL",
      { pngDataUrl: "data:image/svg+xml;base64,PHN2Zz4=" },
    ],
    ["a remote URL", { pngDataUrl: "https://example.com/icon.png" }],
    [
      "an oversized payload",
      {
        pngDataUrl: `data:image/png;base64,${"A".repeat(BB_DESKTOP_APP_ICON_MAX_DATA_URL_LENGTH)}`,
      },
    ],
    ["extra fields", { pngDataUrl: PNG_DATA_URL, path: "/etc/passwd" }],
    ["a bare string", PNG_DATA_URL],
  ])("ignores %s without decoding it", (_label, payload) => {
    const { controller, decoded, dockIcons } = createHarness("darwin");

    controller.handleMessage(payload);

    expect(decoded).toEqual([]);
    expect(dockIcons).toEqual([]);
  });

  it("keeps the current icon when the PNG fails to decode", () => {
    const { controller, dockIcons } = createHarness("darwin");

    controller.handleMessage({ pngDataUrl: PNG_DATA_URL });
    controller.handleMessage({ pngDataUrl: "data:image/png;base64,empty" });
    controller.handleMessage(null);

    expect(dockIcons).toEqual(["custom", "bundled"]);
  });
});
