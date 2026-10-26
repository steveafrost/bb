import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  collectLogPayloads,
  getHelpOutput,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerThemeCommands } from "../../commands/theme.js";

describe("bb theme commands", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThemeCommands(program, () => "http://server");

  function stubAppearance(themeId = "dracula", faviconColor = "purple") {
    const put = vi.fn(async ({ json }) => ({
      ...json,
      customCss: null,
      resolvedCodeTheme: {
        dark: "pierre-dark",
        light: "pierre-light",
        files: {},
      },
    }));
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        appearance: {
          themeId,
          faviconColor,
          customCss: null,
          resolvedCodeTheme: {
            dark: "pierre-dark",
            light: "pierre-light",
            files: {},
          },
        },
      })),
      "v1.settings.appearance.$put": put,
    });
    return put;
  }

  it("preserves the favicon color for a theme-only update", async () => {
    const put = stubAppearance();

    await runCommand(["theme", "set", "nord"], register);

    expect(put).toHaveBeenCalledWith({
      json: { themeId: "nord", faviconColor: "purple" },
    });
  });

  it("sends and prints a complete selection update as JSON", async () => {
    const put = stubAppearance();

    await runCommand(
      ["theme", "set", "nord", "--favicon-color", "teal", "--json"],
      register,
    );

    expect(put).toHaveBeenCalledWith({
      json: { themeId: "nord", faviconColor: "teal" },
    });
    expect(collectLogPayloads(vi.mocked(console.log))).toEqual([
      JSON.stringify(
        {
          themeId: "nord",
          faviconColor: "teal",
          customCss: null,
          resolvedCodeTheme: {
            dark: "pierre-dark",
            light: "pierre-light",
            files: {},
          },
        },
        null,
        2,
      ),
    ]);
  });

  it("sets and resets the favicon color without changing the theme", async () => {
    const put = stubAppearance("plugin:palette:ocean", "purple");

    await runCommand(["theme", "favicon", "set", "blue"], register);
    await runCommand(["theme", "favicon", "reset"], register);

    expect(put).toHaveBeenNthCalledWith(1, {
      json: { themeId: "plugin:palette:ocean", faviconColor: "blue" },
    });
    expect(put).toHaveBeenNthCalledWith(2, {
      json: { themeId: "plugin:palette:ocean", faviconColor: "default" },
    });
  });

  it("resets the theme without resetting the favicon color", async () => {
    const put = stubAppearance("nord", "pink");

    await runCommand(["theme", "reset"], register);

    expect(put).toHaveBeenCalledWith({
      json: { themeId: "default", faviconColor: "pink" },
    });
  });

  it("rejects invalid favicon colors before writing", async () => {
    const put = stubAppearance();

    await expect(
      runCommand(["theme", "favicon", "set", "chartreuse"], register),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(
        ["theme", "set", "nord", "--favicon-color", "chartreuse"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(put).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
      "Invalid favicon color 'chartreuse'",
    );
  });

  it("uploads the icon file bytes and reports the stored icon", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bb-cli-app-icon-"));
    try {
      const iconPath = join(dir, "logo.png");
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
      await writeFile(iconPath, bytes);
      vi.mocked(globalThis.fetch).mockResolvedValue(
        new Response(
          JSON.stringify({
            themeId: "default",
            faviconColor: "default",
            customCss: null,
            appIcon: {
              contentType: "image/png",
              hash: "a".repeat(64),
              byteLength: bytes.byteLength,
              updatedAt: 1,
            },
            resolvedCodeTheme: {
              dark: "pierre-dark",
              light: "pierre-light",
              files: {},
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

      await runCommand(["theme", "icon", "set", iconPath], register);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "http://server/api/v1/settings/app-icon",
        expect.objectContaining({ method: "PUT", body: expect.any(FormData) }),
      );
      const body = vi.mocked(globalThis.fetch).mock.calls[0]?.[1]?.body;
      if (!(body instanceof FormData)) throw new Error("Missing upload body");
      const file = body.get("file");
      if (!(file instanceof File)) throw new Error("Missing uploaded file");
      expect(file.name).toBe("logo.png");
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
      expect(collectLogLines(vi.mocked(console.log))).toEqual([
        "App icon set to custom PNG (10 bytes)",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails before uploading when the icon path does not exist", async () => {
    await expect(
      runCommand(
        ["theme", "icon", "set", join(tmpdir(), "bb-missing-icon.png")],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("resets the app icon through the settings route", async () => {
    const reset = vi.fn(async () => ({
      themeId: "default",
      faviconColor: "default",
      customCss: null,
      appIcon: null,
      resolvedCodeTheme: {
        dark: "pierre-dark",
        light: "pierre-light",
        files: {},
      },
    }));
    stubServerApi({ "v1.settings.app-icon.$delete": reset });

    await runCommand(["theme", "icon", "reset"], register);

    expect(reset).toHaveBeenCalledTimes(1);
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "App icon reset to the bundled icon",
    ]);
  });

  it("does not list a code-theme command in help", async () => {
    const themeHelp = await getHelpOutput(["theme"], register);

    expect(themeHelp).not.toContain("code-theme");
  });
});
