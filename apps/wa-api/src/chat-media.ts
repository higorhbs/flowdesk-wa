import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type ChatMediaType = "image" | "video" | "audio";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);
const AUDIO_TYPES = new Set([
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/webm",
  "audio/opus",
]);

const MAX_BYTES = 16 * 1024 * 1024;

export function chatMediaRoot(): string {
  const custom = process.env.WA_CHAT_MEDIA_PATH?.trim();
  if (custom) return path.resolve(custom);
  const sessions = process.env.WA_SESSION_PATH?.trim();
  if (sessions) return path.join(path.dirname(path.resolve(sessions)), "chat-media");
  return path.resolve("./data/chat-media");
}

export function publicChatMediaUrl(businessId: string, fileName: string): string {
  const base =
    process.env.WA_API_PUBLIC_URL?.trim()?.replace(/\/$/, "") ||
    `http://localhost:${process.env.API_PORT?.trim() || "3001"}`;
  return `${base}/chat-media/${businessId}/${fileName}`;
}

export function validateChatUpload(mimetype: string, size: number): ChatMediaType {
  if (size > MAX_BYTES) throw new Error("Arquivo muito grande (máx. 16 MB).");
  if (IMAGE_TYPES.has(mimetype)) return "image";
  if (VIDEO_TYPES.has(mimetype)) return "video";
  if (AUDIO_TYPES.has(mimetype) || mimetype.startsWith("audio/")) return "audio";
  throw new Error("Use imagem (JPEG, PNG, WebP), vídeo MP4 ou áudio (OGG, MP3, M4A).");
}

function extFor(mimetype: string, mediaType: ChatMediaType): string {
  if (mediaType === "image") {
    if (mimetype === "image/png") return "png";
    if (mimetype === "image/webp") return "webp";
    return "jpg";
  }
  if (mediaType === "video") return "mp4";
  if (mimetype.includes("mpeg")) return "mp3";
  if (mimetype.includes("mp4")) return "m4a";
  return "ogg";
}

export async function saveChatMedia(
  businessId: string,
  buffer: Buffer,
  mimetype: string,
  mediaType?: ChatMediaType
): Promise<{ mediaUrl: string; mediaType: ChatMediaType }> {
  const kind = mediaType ?? validateChatUpload(mimetype, buffer.length);
  const root = chatMediaRoot();
  const dir = path.join(root, businessId);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${randomUUID()}.${extFor(mimetype, kind)}`;
  fs.writeFileSync(path.join(dir, fileName), buffer);
  return { mediaUrl: publicChatMediaUrl(businessId, fileName), mediaType: kind };
}
