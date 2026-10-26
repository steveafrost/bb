import {
  appThemeSchema,
  type AppTheme,
  type AppThemeSelection,
} from "@bb/domain";
import type { ThemeCatalogResponse } from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export type ThemeGetResult = AppTheme;
export type ThemeCatalogResult = ThemeCatalogResponse;
export type ThemeSetInput = AppThemeSelection;
export type ThemeSetResult = AppTheme;
export type ThemeResolveResult = AppTheme;

export interface ThemeCatalogArgs {
  signal?: AbortSignal;
}

export interface ThemeGetArgs {
  signal?: AbortSignal;
}

export interface ThemeResolveArgs {
  themeId: string;
  signal?: AbortSignal;
}

export interface ThemeSetAppIconInput {
  icon: Blob | Uint8Array;
  filename?: string;
  signal?: AbortSignal;
}

export interface ThemeResetAppIconArgs {
  signal?: AbortSignal;
}

export interface ThemeArea {
  get(args?: ThemeGetArgs): Promise<ThemeGetResult>;
  catalog(args?: ThemeCatalogArgs): Promise<ThemeCatalogResult>;
  resolve(args: ThemeResolveArgs): Promise<ThemeResolveResult>;
  set(selection: ThemeSetInput): Promise<ThemeSetResult>;
  set(themeId: string): Promise<ThemeSetResult>;
  setAppIcon(input: ThemeSetAppIconInput): Promise<ThemeSetResult>;
  resetAppIcon(args?: ThemeResetAppIconArgs): Promise<ThemeSetResult>;
}

export function createThemeArea(args: CreateSdkAreaArgs): ThemeArea {
  const { transport } = args;
  return {
    async get(input = {}) {
      const config = await transport.readJson(
        transport.api.v1.system.config.$get(
          {},
          ...signalRequestArgs(input.signal),
        ),
      );
      return config.appearance;
    },
    async catalog(input = {}) {
      return transport.readJson(
        transport.api.v1.settings.themes.$get(
          {},
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async resolve(input) {
      return transport.readJson(
        transport.api.v1.settings.themes[":id"].$get(
          { param: { id: input.themeId } },
          ...signalRequestArgs(input.signal),
        ),
      );
    },
    async set(input) {
      if (typeof input === "string") {
        const appearance = (
          await transport.readJson(transport.api.v1.system.config.$get())
        ).appearance;
        return transport.readJson(
          transport.api.v1.settings.appearance.$put({
            json: {
              themeId: input,
              faviconColor: appearance.faviconColor,
            },
          }),
        );
      }
      return transport.readJson(
        transport.api.v1.settings.appearance.$put({ json: input }),
      );
    },
    async setAppIcon(input) {
      const blob =
        input.icon instanceof Blob
          ? input.icon
          : new Blob([new Uint8Array(input.icon)]);
      if (blob.size === 0) {
        throw new Error("App icon file must not be empty");
      }
      const form = new FormData();
      form.set("file", blob, input.filename ?? "app-icon");
      const baseUrl = transport.baseUrl.replace(/\/$/u, "");
      const response = await transport.resolve(
        transport.fetch(`${baseUrl}/api/v1/settings/app-icon`, {
          method: "PUT",
          body: form,
          signal: input.signal,
        }),
      );
      return appThemeSchema.parse(await response.json());
    },
    async resetAppIcon(input = {}) {
      return transport.readJson(
        transport.api.v1.settings["app-icon"].$delete(
          {},
          ...signalRequestArgs(input.signal),
        ),
      );
    },
  };
}
