import type { ImageContent } from "@mariozechner/pi-ai";
import { getImageModule } from "./deps.js";

const { createImgBase64ByFormat, imageInfoOfBase64, parseBase64, resizeImgBase64 } = getImageModule();

type SnapshotResizeOptions = {
	maxWidth: number;
	maxHeight: number;
};

const DEFAULT_OPTIONS: SnapshotResizeOptions = {
	maxWidth: 448,
	maxHeight: 448,
};

function toDataUrl(image: ImageContent): string {
	const format = image.mimeType.split("/")[1] ?? "png";
	return createImgBase64ByFormat(format, image.data);
}

function clampSize(width: number, height: number, options: SnapshotResizeOptions): { width: number; height: number } {
	if (width <= options.maxWidth && height <= options.maxHeight) {
		return { width, height };
	}
	const scale = Math.min(options.maxWidth / width, options.maxHeight / height);
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

export async function resizeSnapshotImage(
	image: ImageContent,
	options: SnapshotResizeOptions = DEFAULT_OPTIONS,
): Promise<ImageContent> {
	try {
		const base64 = toDataUrl(image);
		const info = await imageInfoOfBase64(base64);
		const nextSize = clampSize(info.width, info.height, options);
		if (nextSize.width === info.width && nextSize.height === info.height) {
			return image;
		}
		const resized = await resizeImgBase64(base64, nextSize);
		const parsed = parseBase64(resized);
		return {
			type: "image",
			data: parsed.body,
			mimeType: parsed.mimeType,
		};
	} catch {
		return image;
	}
}
