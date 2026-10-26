// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppTheme, type AppTheme } from "@bb/domain";
import { AppearanceSettingsSection } from "./SettingsView";

afterEach(async () => {
  cleanup();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
});

const CUSTOM_ICON: NonNullable<AppTheme["appIcon"]> = {
  contentType: "image/png",
  hash: "c".repeat(64),
  byteLength: 42,
  updatedAt: 1,
};

function renderSection(appIcon: AppTheme["appIcon"], disabled = false) {
  const onAppIconUpload = vi.fn();
  const onAppIconReset = vi.fn();
  render(
    <AppearanceSettingsSection
      appIconDisabled={disabled}
      onAppIconReset={onAppIconReset}
      onAppIconUpload={onAppIconUpload}
      appearance={{ ...defaultAppTheme, appIcon }}
      appearanceDisabled={false}
      customThemes={[]}
      pluginThemes={[]}
      faviconColor="default"
      onAppearanceThemeChange={vi.fn()}
      onAppearanceThemePrefetch={vi.fn()}
      onAppearanceThemePreview={vi.fn()}
      onCreatePalette={vi.fn()}
      onFaviconColorChange={vi.fn()}
      onThemePreferenceChange={vi.fn()}
      themePreference="system"
    />,
  );
  return { onAppIconReset, onAppIconUpload };
}

function chooseFile(file: File): HTMLInputElement {
  const input = screen.getByLabelText<HTMLInputElement>("App icon file");
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [file],
  });
  fireEvent.change(input);
  return input;
}

describe("app icon setting", () => {
  it("offers upload without reset when no custom icon is set", () => {
    renderSection(null);

    expect(screen.getByRole("button", { name: "Upload" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    expect(screen.queryByAltText("Current app icon")).toBeNull();
    expect(
      screen.getByLabelText<HTMLInputElement>("App icon file").accept,
    ).toBe("image/png,image/svg+xml,.png,.svg");
  });

  it("previews the stored icon by hash and resets it", () => {
    const { onAppIconReset } = renderSection(CUSTOM_ICON);

    expect(
      screen.getByAltText<HTMLImageElement>("Current app icon").src,
    ).toContain(`/api/v1/system/app-icon?h=${CUSTOM_ICON.hash}`);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(onAppIconReset).toHaveBeenCalledTimes(1);
  });

  it("uploads the chosen file and clears the input so the same file can be chosen again", () => {
    const { onAppIconUpload } = renderSection(CUSTOM_ICON);
    const file = new File([new Uint8Array([1])], "logo.png", {
      type: "image/png",
    });

    const input = chooseFile(file);
    chooseFile(file);

    expect(onAppIconUpload).toHaveBeenNthCalledWith(1, file);
    expect(onAppIconUpload).toHaveBeenNthCalledWith(2, file);
    expect(input.value).toBe("");
  });

  it("disables both actions while a change is saving", () => {
    renderSection(CUSTOM_ICON, true);

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Replace" })
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Reset" }).disabled,
    ).toBe(true);
  });
});
