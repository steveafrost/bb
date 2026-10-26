import { createHash } from "node:crypto";
import {
  APP_ICON_MAX_BYTES,
  APP_ICON_MAX_PIXELS,
  APP_ICON_MIN_PIXELS,
  type AppIconContentType,
} from "@bb/domain";
import type { StoredAppIconContent } from "@bb/db";
import { assertValidAppIconSvg } from "@bb/plugin-build";
import { ApiError } from "../../errors.js";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IHDR_END = 24;
const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

export const APP_ICON_UPLOAD_MAX_REQUEST_BYTES =
  APP_ICON_MAX_BYTES + MULTIPART_OVERHEAD_BYTES;

interface PngDimensions {
  width: number;
  height: number;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
  );
}

export function readPngDimensions(bytes: Uint8Array): PngDimensions | null {
  if (!hasPngSignature(bytes) || bytes.byteLength < PNG_IHDR_END) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkType = String.fromCharCode(...bytes.subarray(12, 16));
  if (view.getUint32(8) !== 13 || chunkType !== "IHDR") return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function invalidIcon(message: string): ApiError {
  return new ApiError(400, "invalid_app_icon", message);
}

function detectContentType(bytes: Uint8Array): AppIconContentType {
  if (hasPngSignature(bytes)) {
    const dimensions = readPngDimensions(bytes);
    if (dimensions === null) {
      throw invalidIcon("App icon PNG is missing a valid IHDR header");
    }
    const { width, height } = dimensions;
    if (width !== height) {
      throw invalidIcon(`App icon PNG must be square; got ${width}x${height}`);
    }
    if (width < APP_ICON_MIN_PIXELS || width > APP_ICON_MAX_PIXELS) {
      throw invalidIcon(
        `App icon PNG must be between ${APP_ICON_MIN_PIXELS} and ${APP_ICON_MAX_PIXELS} pixels square; got ${width}x${height}`,
      );
    }
    return "image/png";
  }
  if (!/<svg[\s>]/iu.test(new TextDecoder("utf-8").decode(bytes))) {
    throw invalidIcon("App icon must be a PNG or SVG image");
  }
  try {
    assertValidAppIconSvg(bytes);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw invalidIcon(reason);
  }
  return "image/svg+xml";
}

export function assertAppIconRequestSize(contentLength: string | undefined) {
  if (contentLength === undefined) return;
  const declared = Number(contentLength);
  if (
    Number.isFinite(declared) &&
    declared > APP_ICON_UPLOAD_MAX_REQUEST_BYTES
  ) {
    throw appIconTooLarge();
  }
}

function appIconTooLarge(): ApiError {
  return new ApiError(
    413,
    "app_icon_too_large",
    `App icon must be at most ${APP_ICON_MAX_BYTES} bytes`,
  );
}

export async function readAppIconUpload(
  formData: FormData,
): Promise<StoredAppIconContent> {
  const fields = [...formData.keys()];
  if (fields.length !== 1 || fields[0] !== "file") {
    throw new ApiError(
      400,
      "invalid_request",
      'App icon upload accepts exactly one multipart field named "file"',
    );
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new ApiError(400, "invalid_request", "App icon file is required");
  }
  if (file.size === 0) {
    throw invalidIcon("App icon file is empty");
  }
  if (file.size > APP_ICON_MAX_BYTES) {
    throw appIconTooLarge();
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  return {
    contentType: detectContentType(bytes),
    hash: createHash("sha256").update(bytes).digest("hex"),
    bytes,
  };
}

export function buildAppIconManifest(icon: StoredAppIconContent) {
  const src = `/api/v1/system/app-icon?h=${icon.hash}`;
  const dimensions =
    icon.contentType === "image/png" ? readPngDimensions(icon.bytes) : null;
  const sizes =
    dimensions === null ? "any" : `${dimensions.width}x${dimensions.height}`;
  return {
    name: "bb",
    short_name: "bb",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [{ src, sizes, type: icon.contentType, purpose: "any" }],
  };
}
