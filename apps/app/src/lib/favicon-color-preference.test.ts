// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppTheme } from "@bb/domain";
import {
  APP_ICON_STORAGE_KEY,
  FAVICON_COLOR_STORAGE_KEY,
  useFaviconColorSync,
} from "./favicon-color-preference";

const mocks = vi.hoisted(() => ({
  useSystemConfig: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: mocks.useSystemConfig,
}));

function setSystemFaviconColor(
  faviconColor: typeof defaultAppTheme.faviconColor,
): void {
  mocks.useSystemConfig.mockReturnValue({
    data: {
      appearance: {
        ...defaultAppTheme,
        faviconColor,
      },
    },
  });
}

const APP_ICON_HASH = "a".repeat(64);
const PNG_APP_ICON = {
  contentType: "image/png" as const,
  hash: APP_ICON_HASH,
};

describe("favicon color server sync", () => {
  afterEach(() => {
    window.localStorage.clear();
    cleanup();
    vi.clearAllMocks();
  });

  it("mirrors the server tint into the first-paint cache", async () => {
    window.localStorage.setItem(FAVICON_COLOR_STORAGE_KEY, "teal");
    setSystemFaviconColor("purple");
    const { rerender } = renderHook(() => useFaviconColorSync());

    await waitFor(() =>
      expect(window.localStorage.getItem(FAVICON_COLOR_STORAGE_KEY)).toBe(
        "purple",
      ),
    );

    setSystemFaviconColor("default");
    rerender();

    await waitFor(() =>
      expect(window.localStorage.getItem(FAVICON_COLOR_STORAGE_KEY)).toBeNull(),
    );
  });

  it("mirrors the server app icon into the first-paint cache and clears it on reset", async () => {
    mocks.useSystemConfig.mockReturnValue({
      data: {
        appearance: {
          ...defaultAppTheme,
          appIcon: { ...PNG_APP_ICON, byteLength: 10, updatedAt: 1 },
        },
      },
    });
    const { rerender } = renderHook(() => useFaviconColorSync());

    await waitFor(() =>
      expect(
        JSON.parse(window.localStorage.getItem(APP_ICON_STORAGE_KEY) ?? "null"),
      ).toEqual(PNG_APP_ICON),
    );

    mocks.useSystemConfig.mockReturnValue({ data: undefined });
    rerender();
    expect(window.localStorage.getItem(APP_ICON_STORAGE_KEY)).not.toBeNull();

    setSystemFaviconColor("default");
    rerender();

    await waitFor(() =>
      expect(window.localStorage.getItem(APP_ICON_STORAGE_KEY)).toBeNull(),
    );
  });
});

describe("favicon rendering", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => null,
    });
  });

  afterEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: originalGetContext,
    });
    cleanup();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function stubDisplayMode(standalone: boolean): void {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(display-mode: standalone)" ? standalone : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
  }

  class FakeImage {
    static created = 0;
    naturalWidth = 32;
    naturalHeight = 32;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      FakeImage.created += 1;
      queueMicrotask(() => this.onload?.());
    }
  }

  async function loadFreshModule() {
    return import("./favicon-color-preference");
  }

  it("decodes each base glyph once across badge flips", async () => {
    stubDisplayMode(false);
    FakeImage.created = 0;
    vi.stubGlobal("Image", FakeImage);
    const module = await loadFreshModule();
    module.initializeFavicon();

    const initialProps: { badge: "none" | "unread" } = { badge: "unread" };
    const { rerender, unmount } = renderHook(
      ({ badge }: { badge: "none" | "unread" }) =>
        module.useFaviconBadge(badge),
      { initialProps },
    );
    await waitFor(() => expect(FakeImage.created).toBe(2));

    rerender({ badge: "none" });
    rerender({ badge: "unread" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeImage.created).toBe(2);
    unmount();
  });

  function addIconLinks(): void {
    document.head.innerHTML = [
      '<link id="favicon-32" rel="icon" href="/favicon-32x32.png">',
      '<link id="favicon-16" rel="icon" href="/favicon-16x16.png">',
      '<link id="apple-touch-icon" rel="apple-touch-icon" href="/apple-touch-icon.png">',
      '<link id="app-manifest" rel="manifest" href="/manifest.webmanifest">',
    ].join("");
  }

  function linkHref(id: string): string | null {
    return document.getElementById(id)?.getAttribute("href") ?? null;
  }

  function stubDrawableCanvas(): void {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => ({
        arc: () => {},
        beginPath: () => {},
        drawImage: () => {},
        fill: () => {},
        restore: () => {},
        save: () => {},
      }),
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
      function (this: HTMLCanvasElement) {
        return `data:image/png;base64,${this.width}`;
      },
    );
  }

  it("points every install surface at a cached custom icon and hands the Dock a PNG", async () => {
    stubDisplayMode(false);
    stubDrawableCanvas();
    vi.stubGlobal("Image", FakeImage);
    addIconLinks();
    window.localStorage.setItem(
      APP_ICON_STORAGE_KEY,
      JSON.stringify({ ...PNG_APP_ICON, contentType: "image/svg+xml" }),
    );
    const setAppIcon = vi.fn();
    vi.stubGlobal("bbDesktop", { setAppIcon });
    const module = await loadFreshModule();
    module.initializeFavicon();

    const iconHref = `/api/v1/system/app-icon?h=${APP_ICON_HASH}`;
    await waitFor(() => expect(linkHref("favicon-32")).toBe(iconHref));
    expect(linkHref("favicon-16")).toBe(iconHref);
    expect(linkHref("app-manifest")).toBe(
      "/api/v1/system/app-icon/manifest.webmanifest",
    );
    await waitFor(() =>
      expect(linkHref("apple-touch-icon")).toBe("data:image/png;base64,180"),
    );
    await waitFor(() =>
      expect(setAppIcon).toHaveBeenCalledWith({
        pngDataUrl: "data:image/png;base64,512",
      }),
    );

    const { unmount } = renderHook(() => module.useFaviconBadge("unread"));
    await waitFor(() =>
      expect(linkHref("favicon-32")).toBe("data:image/png;base64,64"),
    );
    unmount();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("ignores a corrupt cached icon and tells the desktop shell there is none", async () => {
    stubDisplayMode(false);
    vi.stubGlobal("Image", FakeImage);
    addIconLinks();
    window.localStorage.setItem(
      APP_ICON_STORAGE_KEY,
      JSON.stringify({ contentType: "image/png", hash: "../../etc" }),
    );
    const setAppIcon = vi.fn();
    vi.stubGlobal("bbDesktop", { setAppIcon });
    const module = await loadFreshModule();
    module.initializeFavicon();

    await waitFor(() => expect(setAppIcon).toHaveBeenCalledWith(null));
    expect(linkHref("app-manifest")).toBe("/manifest.webmanifest");
    expect(linkHref("apple-touch-icon")).toBe("/apple-touch-icon.png");
    window.localStorage.clear();
  });

  it("skips favicon image work in standalone display mode", async () => {
    stubDisplayMode(true);
    FakeImage.created = 0;
    vi.stubGlobal("Image", FakeImage);
    const module = await loadFreshModule();
    module.initializeFavicon();

    const { unmount } = renderHook(() => module.useFaviconBadge("unread"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(FakeImage.created).toBe(0);
    unmount();
  });
});
