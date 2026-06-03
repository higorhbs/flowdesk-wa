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

function sniffAudioExt(buffer: Buffer, mimetype: string): string {
  if (buffer.length >= 4 && buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
    return "ogg";
  }
  if (
    buffer.length >= 8 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return "m4a";
  }
  if (buffer.length >= 3 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return "mp3";
  const mt = mimetype.toLowerCase();
  if (mt.includes("mpeg") || mt.includes("mp3")) return "mp3";
  if (mt.includes("mp4") || mt.includes("m4a") || mt.includes("aac")) return "m4a";
  return "ogg";
}

function extFor(mimetype: string, mediaType: ChatMediaType, buffer: Buffer): string {
  if (mediaType === "image") {
    if (mimetype === "image/png") return "png";
    if (mimetype === "image/webp") return "webp";
    return "jpg";
  }
  if (mediaType === "video") return "mp4";
  if (mediaType === "audio") return sniffAudioExt(buffer, mimetype);
  return "bin";
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
  const fileName = `${randomUUID()}.${extFor(mimetype, kind, buffer)}`;
  fs.writeFileSync(path.join(dir, fileName), buffer);
  return { mediaUrl: publicChatMediaUrl(businessId, fileName), mediaType: kind };
}
