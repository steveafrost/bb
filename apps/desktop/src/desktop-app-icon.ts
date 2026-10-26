import { bbDesktopAppIconSchema } from "@bb/desktop-contract";

export interface DesktopAppIconImage {
  isEmpty(): boolean;
}

export interface DesktopAppIconWindow<Image extends DesktopAppIconImage> {
  isDestroyed(): boolean;
  setIcon(icon: Image): void;
}

interface DesktopAppIconControllerArgs<Image extends DesktopAppIconImage> {
  platform: NodeJS.Platform;
  bundledIcon: Image;
  createImageFromDataUrl(dataUrl: string): Image;
  setDockIcon: ((icon: Image) => void) | null;
  listWindows(): readonly DesktopAppIconWindow<Image>[];
}

export interface DesktopAppIconController<Image extends DesktopAppIconImage> {
  handleMessage(payload: unknown): void;
  applyToNewWindow(window: DesktopAppIconWindow<Image>): void;
}

export function createDesktopAppIconController<
  Image extends DesktopAppIconImage,
>(args: DesktopAppIconControllerArgs<Image>): DesktopAppIconController<Image> {
  let customIcon: Image | null = null;

  function apply(icon: Image): void {
    if (args.platform === "darwin") {
      args.setDockIcon?.(icon);
      return;
    }
    for (const window of args.listWindows()) {
      if (!window.isDestroyed()) window.setIcon(icon);
    }
  }

  return {
    handleMessage(payload) {
      const parsed = bbDesktopAppIconSchema.safeParse(payload);
      if (!parsed.success) return;
      if (parsed.data === null) {
        if (customIcon === null) return;
        customIcon = null;
        apply(args.bundledIcon);
        return;
      }
      const image = args.createImageFromDataUrl(parsed.data.pngDataUrl);
      if (image.isEmpty()) return;
      customIcon = image;
      apply(image);
    },
    applyToNewWindow(window) {
      if (args.platform === "darwin" || customIcon === null) return;
      window.setIcon(customIcon);
    },
  };
}
