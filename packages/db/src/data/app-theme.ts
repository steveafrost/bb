import { eq, sql } from "drizzle-orm";
import {
  defaultAppTheme,
  defaultFaviconColor,
  type AppIcon,
  type AppIconContentType,
  type FaviconColorPreference,
} from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { appIcon, appTheme } from "../schema.js";

const APP_THEME_ROW_ID = "current";

export function getStoredThemeId(db: DbConnection): string {
  const row = db
    .select({ themeId: appTheme.themeId })
    .from(appTheme)
    .where(eq(appTheme.id, APP_THEME_ROW_ID))
    .get();

  return row?.themeId ?? defaultAppTheme.themeId;
}

export function getStoredFaviconColor(db: DbConnection): FaviconColorPreference {
  const row = db
    .select({ faviconColor: appTheme.faviconColor })
    .from(appTheme)
    .where(eq(appTheme.id, APP_THEME_ROW_ID))
    .get();

  return row?.faviconColor ?? defaultFaviconColor;
}

export function setStoredAppearance(
  db: DbConnection,
  appearance: { themeId: string; faviconColor: FaviconColorPreference },
): void {
  const updatedAt = Date.now();
  const { themeId, faviconColor } = appearance;
  db.insert(appTheme)
    .values({ id: APP_THEME_ROW_ID, themeId, faviconColor, updatedAt })
    .onConflictDoUpdate({
      target: appTheme.id,
      set: { themeId, faviconColor, updatedAt },
    })
    .run();
}

const APP_ICON_ROW_ID = "current";

export interface StoredAppIconContent {
  contentType: AppIconContentType;
  hash: string;
  bytes: Buffer;
}

export function getStoredAppIcon(db: DbConnection): AppIcon | null {
  const row = db
    .select({
      contentType: appIcon.contentType,
      hash: appIcon.contentHash,
      byteLength: sql<number>`length(${appIcon.bytes})`,
      updatedAt: appIcon.updatedAt,
    })
    .from(appIcon)
    .where(eq(appIcon.id, APP_ICON_ROW_ID))
    .get();
  return row ?? null;
}

export function getStoredAppIconContent(
  db: DbConnection,
): StoredAppIconContent | null {
  const row = db
    .select({
      contentType: appIcon.contentType,
      hash: appIcon.contentHash,
      bytes: appIcon.bytes,
    })
    .from(appIcon)
    .where(eq(appIcon.id, APP_ICON_ROW_ID))
    .get();
  return row ?? null;
}

export function setStoredAppIcon(
  db: DbConnection,
  icon: StoredAppIconContent,
): AppIcon {
  const updatedAt = Date.now();
  const values = {
    contentType: icon.contentType,
    contentHash: icon.hash,
    bytes: icon.bytes,
    updatedAt,
  };
  db.insert(appIcon)
    .values({ id: APP_ICON_ROW_ID, ...values })
    .onConflictDoUpdate({ target: appIcon.id, set: values })
    .run();
  return {
    contentType: icon.contentType,
    hash: icon.hash,
    byteLength: icon.bytes.byteLength,
    updatedAt,
  };
}

export function clearStoredAppIcon(db: DbConnection): void {
  db.delete(appIcon).where(eq(appIcon.id, APP_ICON_ROW_ID)).run();
}
