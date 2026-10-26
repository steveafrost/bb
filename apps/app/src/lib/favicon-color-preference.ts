import { useEffect } from "react";
import { atom, getDefaultStore, useSetAtom } from "jotai";
import {
  appIconSchema,
  defaultFaviconColor,
  faviconColorPreferenceSchema,
  type AppIcon,
  type FaviconColor,
  type FaviconColorPreference,
} from "@bb/domain";
import {
  DARK_COLOR_SCHEME_QUERY,
  getMediaQuerySnapshot,
  subscribeMediaQuery,
} from "@bb/shared-ui/hooks/use-media-query";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

export const FAVICON_COLOR_STORAGE_KEY = "bb.faviconColor";
export const APP_ICON_STORAGE_KEY = "bb.appIcon";

type ActiveAppIcon = Pick<AppIcon, "contentType" | "hash">;

const activeAppIconSchema = appIconSchema.pick({
  contentType: true,
  hash: true,
});

const APP_ICON_MANIFEST_HREF = "/api/v1/system/app-icon/manifest.webmanifest";
const APPLE_TOUCH_ICON_PIXELS = 180;
const DESKTOP_APP_ICON_PIXELS = 512;
const FAVICON_RENDER_SCALE = 2;

export function getAppIconHref(icon: ActiveAppIcon): string {
  return `/api/v1/system/app-icon?h=${icon.hash}`;
}

const FAVICON_BADGES = ["none", "unread"] as const;
type FaviconBadge = (typeof FAVICON_BADGES)[number];

export const FAVICON_COLOR_VALUES: Record<FaviconColor, string> = {
  red: "#e5484d",
  orange: "#f76b15",
  yellow: "#ffba18",
  green: "#30a46c",
  teal: "#12a594",
  blue: "#0090ff",
  purple: "#8e4ec6",
  pink: "#d6409f",
};

function readCachedFaviconColor(): FaviconColorPreference {
  try {
    const parsed = faviconColorPreferenceSchema.safeParse(
      localStorage.getItem(FAVICON_COLOR_STORAGE_KEY),
    );
    return parsed.success ? parsed.data : defaultFaviconColor;
  } catch {
    return defaultFaviconColor;
  }
}

function cacheFaviconColor(color: FaviconColorPreference): void {
  try {
    if (color === defaultFaviconColor) {
      localStorage.removeItem(FAVICON_COLOR_STORAGE_KEY);
    } else {
      localStorage.setItem(FAVICON_COLOR_STORAGE_KEY, color);
    }
  } catch {}
}

function readCachedAppIcon(): ActiveAppIcon | null {
  try {
    const raw = localStorage.getItem(APP_ICON_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = activeAppIconSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function cacheAppIcon(icon: ActiveAppIcon | null): void {
  try {
    if (icon === null) {
      localStorage.removeItem(APP_ICON_STORAGE_KEY);
    } else {
      localStorage.setItem(APP_ICON_STORAGE_KEY, JSON.stringify(icon));
    }
  } catch {}
}

const faviconColorAtom = atom<FaviconColorPreference>(readCachedFaviconColor());
const faviconBadgeAtom = atom<FaviconBadge>("none");
const appIconAtom = atom<ActiveAppIcon | null>(readCachedAppIcon());

function setActiveFaviconColor(color: FaviconColorPreference): void {
  getDefaultStore().set(faviconColorAtom, color);
  cacheFaviconColor(color);
}

function setActiveAppIcon(icon: ActiveAppIcon | null): void {
  const store = getDefaultStore();
  const current = store.get(appIconAtom);
  cacheAppIcon(icon);
  if (
    current?.hash === icon?.hash &&
    current?.contentType === icon?.contentType
  ) {
    return;
  }
  store.set(appIconAtom, icon);
}

export function useFaviconColorSync(): void {
  const { data } = useSystemConfig();
  const faviconColor = data?.appearance.faviconColor;
  const appIcon = data?.appearance.appIcon;
  const appIconHash =
    appIcon === undefined ? undefined : (appIcon?.hash ?? null);
  const appIconContentType = appIcon?.contentType ?? null;

  useEffect(() => {
    if (faviconColor === undefined) return;
    setActiveFaviconColor(faviconColor);
  }, [faviconColor]);

  useEffect(() => {
    if (appIconHash === undefined) return;
    setActiveAppIcon(
      appIconHash === null || appIconContentType === null
        ? null
        : { hash: appIconHash, contentType: appIconContentType },
    );
  }, [appIconHash, appIconContentType]);
}

export function useFaviconBadge(badge: FaviconBadge): void {
  const setFaviconBadge = useSetAtom(faviconBadgeAtom);

  useEffect(() => {
    setFaviconBadge(badge);
    return () => {
      setFaviconBadge("none");
    };
  }, [badge, setFaviconBadge]);
}

const FAVICON_SIZES = [32, 16] as const;
const UNREAD_BADGE_FILL = "#e00000";
const WEB_MANIFEST_LINK_ID = "app-manifest";
const APPLE_TOUCH_ICON_LINK_ID = "apple-touch-icon";

type FaviconSize = (typeof FAVICON_SIZES)[number];

interface FaviconRenderState {
  appIcon: ActiveAppIcon | null;
  badge: FaviconBadge;
  colorPreference: FaviconColorPreference;
}

interface FaviconRenderRequest extends FaviconRenderState {
  baseHref: string;
  size: FaviconSize;
}

interface RenderedFaviconLink {
  href: string;
  size: FaviconSize;
}

interface UnreadBadgeDot {
  centerX: number;
  centerY: number;
  radius: number;
}

export function getFaviconGlyphHref(): string {
  return import.meta.env.DEV ? "/favicon-32x32-dev.png" : "/favicon-32x32.png";
}

function getFaviconVariantSuffix(): string {
  if (import.meta.env.DEV) return "-dev";
  return getMediaQuerySnapshot(DARK_COLOR_SCHEME_QUERY) ? "-dark" : "";
}

function getFaviconLink(size: number): HTMLLinkElement | null {
  const element = document.getElementById(`favicon-${size}`);
  return element instanceof HTMLLinkElement ? element : null;
}

function getDocumentLink(id: string): HTMLLinkElement | null {
  const element = document.getElementById(id);
  return element instanceof HTMLLinkElement ? element : null;
}

function getTintedAssetSuffix(colorPreference: FaviconColorPreference): string {
  return colorPreference === defaultFaviconColor ? "" : `-${colorPreference}`;
}

function getPwaManifestHref(colorPreference: FaviconColorPreference): string {
  return `/manifest${getTintedAssetSuffix(colorPreference)}.webmanifest`;
}

function getAppleTouchIconHref(
  colorPreference: FaviconColorPreference,
): string {
  return `/apple-touch-icon${getTintedAssetSuffix(colorPreference)}.png`;
}

async function applyInstallIconState(
  colorPreference: FaviconColorPreference,
  appIcon: ActiveAppIcon | null,
): Promise<void> {
  const manifestLink = getDocumentLink(WEB_MANIFEST_LINK_ID);
  if (manifestLink) {
    manifestLink.href =
      appIcon === null
        ? getPwaManifestHref(colorPreference)
        : APP_ICON_MANIFEST_HREF;
  }

  const appleTouchIconLink = getDocumentLink(APPLE_TOUCH_ICON_LINK_ID);
  if (!appleTouchIconLink) return;
  if (appIcon === null) {
    appleTouchIconLink.href = getAppleTouchIconHref(colorPreference);
    return;
  }
  if (appIcon.contentType === "image/png") {
    appleTouchIconLink.href = getAppIconHref(appIcon);
    return;
  }
  const canvas = await renderAppIconCanvas(appIcon, APPLE_TOUCH_ICON_PIXELS);
  appleTouchIconLink.href = canvas.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error(`Failed to load favicon image: ${src}`));
    image.src = src;
  });
}

const baseImageCache = new Map<string, Promise<HTMLImageElement>>();

function loadBaseImage(src: string): Promise<HTMLImageElement> {
  const cached = baseImageCache.get(src);
  if (cached) return cached;
  const pending = loadImage(src);
  baseImageCache.set(src, pending);
  pending.catch(() => {
    baseImageCache.delete(src);
  });
  return pending;
}

const STANDALONE_DISPLAY_MODE_QUERY = "(display-mode: standalone)";

function createCanvasContext(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context unavailable");
  return { canvas, context };
}

export async function renderAppIconCanvas(
  appIcon: ActiveAppIcon,
  pixels: number,
): Promise<HTMLCanvasElement> {
  const image = await loadBaseImage(getAppIconHref(appIcon));
  const { canvas, context } = createCanvasContext(pixels, pixels);
  const naturalWidth = image.naturalWidth || pixels;
  const naturalHeight = image.naturalHeight || pixels;
  const scale = Math.min(pixels / naturalWidth, pixels / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    (pixels - width) / 2,
    (pixels - height) / 2,
    width,
    height,
  );
  return canvas;
}

async function createFaviconHref({
  appIcon,
  badge,
  baseHref,
  colorPreference,
  size,
}: FaviconRenderRequest): Promise<string> {
  if (appIcon !== null) {
    if (badge === "none") return getAppIconHref(appIcon);
    const canvas = await renderAppIconCanvas(
      appIcon,
      size * FAVICON_RENDER_SCALE,
    );
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");
    drawUnreadBadge(context, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  }

  if (badge === "none" && colorPreference === "default") {
    return baseHref;
  }

  const image = await loadBaseImage(baseHref);
  const { canvas, context } = createCanvasContext(
    image.naturalWidth,
    image.naturalHeight,
  );
  context.drawImage(image, 0, 0);

  if (colorPreference !== "default") {
    context.globalCompositeOperation = "source-in";
    context.fillStyle = FAVICON_COLOR_VALUES[colorPreference];
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = "source-over";
  }

  if (badge === "unread") {
    drawUnreadBadge(context, canvas.width, canvas.height);
  }

  return canvas.toDataURL("image/png");
}

function getUnreadBadgeDot(width: number, height: number): UnreadBadgeDot {
  const size = Math.min(width, height);
  const scale = size / 32;
  return {
    centerX: 28 * scale,
    centerY: 6 * scale,
    radius: 3.5 * scale,
  };
}

function drawUnreadBadge(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const badge = getUnreadBadgeDot(width, height);
  context.save();
  context.beginPath();
  context.arc(badge.centerX, badge.centerY, badge.radius, 0, Math.PI * 2);
  context.fillStyle = UNREAD_BADGE_FILL;
  context.fill();
  context.restore();
}

let applyToken = 0;

async function applyFaviconState(state: FaviconRenderState): Promise<void> {
  const token = ++applyToken;
  if (getMediaQuerySnapshot(STANDALONE_DISPLAY_MODE_QUERY)) return;
  const suffix = getFaviconVariantSuffix();
  const links = await Promise.all(
    FAVICON_SIZES.map(async (size): Promise<RenderedFaviconLink> => {
      const baseHref = `/favicon-${size}x${size}${suffix}.png`;
      const href = await createFaviconHref({
        appIcon: state.appIcon,
        badge: state.badge,
        baseHref,
        colorPreference: state.colorPreference,
        size,
      });
      return { href, size };
    }),
  );
  if (token !== applyToken) return;
  for (const { href, size } of links) {
    const link = getFaviconLink(size);
    if (link) link.href = href;
  }
}

let desktopAppIconToken = 0;

async function applyDesktopAppIcon(
  appIcon: ActiveAppIcon | null,
): Promise<void> {
  const desktopApi = getBbDesktopInfo();
  if (!desktopApi?.setAppIcon) return;
  const token = ++desktopAppIconToken;
  if (appIcon === null) {
    desktopApi.setAppIcon(null);
    return;
  }
  const canvas = await renderAppIconCanvas(appIcon, DESKTOP_APP_ICON_PIXELS);
  if (token !== desktopAppIconToken) return;
  desktopApi.setAppIcon({ pngDataUrl: canvas.toDataURL("image/png") });
}

let initialized = false;

export function initializeFavicon(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  const store = getDefaultStore();
  const apply = () => {
    const colorPreference = store.get(faviconColorAtom);
    const appIcon = store.get(appIconAtom);
    void applyInstallIconState(colorPreference, appIcon).catch(() => {});

    void applyFaviconState({
      appIcon,
      badge: store.get(faviconBadgeAtom),
      colorPreference,
    }).catch(() => {});
  };
  const applyDesktop = () => {
    void applyDesktopAppIcon(store.get(appIconAtom)).catch(() => {});
  };
  store.sub(faviconColorAtom, apply);
  store.sub(faviconBadgeAtom, apply);
  store.sub(appIconAtom, apply);
  store.sub(appIconAtom, applyDesktop);
  subscribeMediaQuery(DARK_COLOR_SCHEME_QUERY, apply);
  apply();
  applyDesktop();
}
