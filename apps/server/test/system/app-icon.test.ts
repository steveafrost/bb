import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getStoredAppIcon } from "@bb/db";
import { APP_ICON_MAX_BYTES, appThemeSchema } from "@bb/domain";
import { systemConfigResponseSchema } from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const APP_PUBLIC_DIR = new URL("../../../app/public/", import.meta.url);
const BUNDLED_PNG = new Uint8Array(
  readFileSync(fileURLToPath(new URL("icon-512.png", APP_PUBLIC_DIR))),
);
const STATIC_MANIFEST = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("manifest.webmanifest", APP_PUBLIC_DIR)),
    "utf8",
  ),
);

const SVG_ICON = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#303446"/></linearGradient></defs><rect width="10" height="10" rx="2" fill="url(#g)"/></svg>',
);

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

async function uploadIcon(
  harness: TestAppHarness,
  bytes: Uint8Array,
  filename = "icon.png",
): Promise<Response> {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], filename));
  return harness.app.request("/api/v1/settings/app-icon", {
    method: "PUT",
    body: form,
  });
}

describe("custom app icon", () => {
  it("stores a PNG, exposes it in appearance, and serves the exact bytes", async () => {
    await withTestHarness(async (harness) => {
      const put = await uploadIcon(harness, BUNDLED_PNG);
      expect(put.status).toBe(200);
      const appearance = appThemeSchema.parse(await readJson(put));
      expect(appearance.appIcon).toMatchObject({
        contentType: "image/png",
        byteLength: BUNDLED_PNG.byteLength,
      });
      expect(appearance.faviconColor).toBe("default");

      const config = systemConfigResponseSchema.parse(
        await readJson(await harness.app.request("/api/v1/system/config")),
      );
      expect(config.appearance.appIcon).toEqual(appearance.appIcon);

      const hash = appearance.appIcon?.hash ?? "";
      const icon = await harness.app.request(
        `/api/v1/system/app-icon?h=${hash}`,
      );
      expect(icon.status).toBe(200);
      expect(icon.headers.get("content-type")).toBe("image/png");
      expect(icon.headers.get("x-content-type-options")).toBe("nosniff");
      expect(icon.headers.get("cache-control")).toContain("immutable");
      expect(new Uint8Array(await icon.arrayBuffer())).toEqual(BUNDLED_PNG);

      const staleHash = await harness.app.request(
        `/api/v1/system/app-icon?h=${"0".repeat(64)}`,
      );
      expect(staleHash.headers.get("cache-control")).toBe("no-store");
    });
  });

  it("serves an install manifest that matches the bundled one except for its icon", async () => {
    await withTestHarness(async (harness) => {
      const put = await uploadIcon(harness, BUNDLED_PNG);
      const hash = appThemeSchema.parse(await readJson(put)).appIcon?.hash;

      const response = await harness.app.request(
        "/api/v1/system/app-icon/manifest.webmanifest",
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "application/manifest+json",
      );
      const manifest = await readJson(response);
      const { icons: _bundledIcons, ...bundledFields } = STATIC_MANIFEST;
      expect(manifest).toMatchObject(bundledFields);
      expect(manifest).toMatchObject({
        icons: [
          {
            src: `/api/v1/system/app-icon?h=${hash}`,
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
        ],
      });
    });
  });

  it("accepts a script-free SVG and replaces the previous icon", async () => {
    await withTestHarness(async (harness) => {
      await uploadIcon(harness, BUNDLED_PNG);
      const put = await uploadIcon(harness, SVG_ICON, "icon.svg");
      expect(put.status).toBe(200);
      expect(appThemeSchema.parse(await readJson(put)).appIcon).toMatchObject({
        contentType: "image/svg+xml",
        byteLength: SVG_ICON.byteLength,
      });

      const icon = await harness.app.request("/api/v1/system/app-icon");
      expect(icon.headers.get("content-type")).toBe("image/svg+xml");
      expect(icon.headers.get("content-security-policy")).toContain(
        "default-src 'none'",
      );
      const manifest = await readJson(
        await harness.app.request(
          "/api/v1/system/app-icon/manifest.webmanifest",
        ),
      );
      expect(manifest).toMatchObject({ icons: [{ sizes: "any" }] });
    });
  });

  it.each([
    [
      "an SVG with a script",
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ],
    [
      "an SVG with an event handler",
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><rect width="1" height="1"/></svg>',
    ],
    [
      "an SVG that loads an external image",
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png"/></svg>',
    ],
    ["a file that is neither PNG nor SVG", "GIF89a"],
  ])("rejects %s without changing the stored icon", async (_label, body) => {
    await withTestHarness(async (harness) => {
      await uploadIcon(harness, BUNDLED_PNG);
      const before = getStoredAppIcon(harness.db);

      const response = await uploadIcon(
        harness,
        new TextEncoder().encode(body),
        "icon.svg",
      );
      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_app_icon",
      });
      expect(getStoredAppIcon(harness.db)).toEqual(before);
    });
  });

  it("names the accepted formats when the upload is not an image it understands", async () => {
    await withTestHarness(async (harness) => {
      const response = await uploadIcon(
        harness,
        new Uint8Array([0x69, 0x63, 0x6e, 0x73, 0xff, 0xfe, 0x00, 0x01]),
        "icon.icns",
      );
      await expect(readJson(response)).resolves.toEqual({
        code: "invalid_app_icon",
        message: "App icon must be a PNG or SVG image",
      });
    });
  });

  it("explains which SVG construct was refused", async () => {
    await withTestHarness(async (harness) => {
      const response = await uploadIcon(
        harness,
        new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
        "icon.svg",
      );
      await expect(readJson(response)).resolves.toEqual({
        code: "invalid_app_icon",
        message: "App icon SVG must not contain a <script> element",
      });
    });
  });

  it.each([
    [pngHeader(512, 256), "App icon PNG must be square; got 512x256"],
    [
      pngHeader(64, 64),
      "App icon PNG must be between 128 and 4096 pixels square; got 64x64",
    ],
    [
      pngHeader(8192, 8192),
      "App icon PNG must be between 128 and 4096 pixels square; got 8192x8192",
    ],
  ])("rejects PNG dimensions outside the contract", async (bytes, message) => {
    await withTestHarness(async (harness) => {
      const response = await uploadIcon(harness, bytes);
      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toEqual({
        code: "invalid_app_icon",
        message,
      });
      expect(getStoredAppIcon(harness.db)).toBeNull();
    });
  });

  it("rejects empty, oversized, and malformed uploads", async () => {
    await withTestHarness(async (harness) => {
      const empty = await uploadIcon(harness, new Uint8Array());
      expect(empty.status).toBe(400);

      const oversizedBytes = new Uint8Array(APP_ICON_MAX_BYTES + 1);
      oversizedBytes.set(pngHeader(512, 512));
      const oversized = await uploadIcon(harness, oversizedBytes);
      expect(oversized.status).toBe(413);
      await expect(readJson(oversized)).resolves.toMatchObject({
        code: "app_icon_too_large",
      });

      const declaredTooLarge = await harness.app.request(
        "/api/v1/settings/app-icon",
        {
          method: "PUT",
          headers: {
            "content-type": "multipart/form-data; boundary=x",
            "content-length": String(64 * 1024 * 1024),
          },
          body: "--x--",
        },
      );
      expect(declaredTooLarge.status).toBe(413);

      const form = new FormData();
      form.set("file", new File([new Uint8Array(BUNDLED_PNG)], "icon.png"));
      form.set("extra", "value");
      const extraField = await harness.app.request(
        "/api/v1/settings/app-icon",
        { method: "PUT", body: form },
      );
      expect(extraField.status).toBe(400);

      const notMultipart = await harness.app.request(
        "/api/v1/settings/app-icon",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      expect(notMultipart.status).toBe(400);
      expect(getStoredAppIcon(harness.db)).toBeNull();
    });
  });

  it("resets to no icon and stops serving the bytes and manifest", async () => {
    await withTestHarness(async (harness) => {
      await uploadIcon(harness, BUNDLED_PNG);
      const reset = await harness.app.request("/api/v1/settings/app-icon", {
        method: "DELETE",
      });
      expect(reset.status).toBe(200);
      expect(appThemeSchema.parse(await readJson(reset)).appIcon).toBeNull();
      expect(getStoredAppIcon(harness.db)).toBeNull();

      expect(
        (await harness.app.request("/api/v1/system/app-icon")).status,
      ).toBe(404);
      expect(
        (
          await harness.app.request(
            "/api/v1/system/app-icon/manifest.webmanifest",
          )
        ).status,
      ).toBe(404);
    });
  });

  it("keeps the icon when the palette or favicon color changes", async () => {
    await withTestHarness(async (harness) => {
      const put = await uploadIcon(harness, BUNDLED_PNG);
      const icon = appThemeSchema.parse(await readJson(put)).appIcon;
      const appearance = await harness.app.request(
        "/api/v1/settings/appearance",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ themeId: "nord", faviconColor: "teal" }),
        },
      );
      expect(appThemeSchema.parse(await readJson(appearance)).appIcon).toEqual(
        icon,
      );
    });
  });
});
