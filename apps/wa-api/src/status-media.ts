import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);

export function statusMediaRoot(): string {
  const custom = process.env.WA_STATUS_MEDIA_PATH?.trim();
  if (custom) return path.resolve(custom);
  const sessions = process.env.WA_SESSION_PATH?.trim();
  if (sessions) return path.join(path.dirname(path.resolve(sessions)), "status-media");
  return path.resolve("./data/status-media");
}

export function publicStatusMediaUrl(businessId: string, fileName: string): string {
  const base =
    process.env.WA_API_PUBLIC_URL?.trim()?.replace(/\/$/, "") ||
    `http://localhost:${process.env.API_PORT?.trim() || "3001"}`;
  return `${base}/status-media/${businessId}/${fileName}`;
}

export function validateStatusUpload(mimetype: string, size: number) {
  const isImage = IMAGE_TYPES.has(mimetype);
  const isVideo = VIDEO_TYPES.has(mimetype);
  if (!isImage && !isVideo) {
    throw new Error("Use imagem (JPEG, PNG, WebP) ou vídeo MP4.");
  }
  if (size > 16 * 1024 * 1024) {
    throw new Error("Arquivo muito grande (máx. 16 MB).");
  }
  return isVideo ? ("video" as const) : ("image" as const);
}

export async function saveStatusMedia(
  businessId: string,
  buffer: Buffer,
  mimetype: string
): Promise<{ mediaUrl: string; mediaType: "image" | "video" }> {
  const mediaType = validateStatusUpload(mimetype, buffer.length);
  const ext =
    mimetype === "image/png"
      ? "png"
      : mimetype === "image/webp"
        ? "webp"
        : mimetype.startsWith("video/")
          ? "mp4"
          : "jpg";
  const root = statusMediaRoot();
  const dir = path.join(root, businessId);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(dir, fileName), buffer);
  return { mediaUrl: publicStatusMediaUrl(businessId, fileName), mediaType };
}
