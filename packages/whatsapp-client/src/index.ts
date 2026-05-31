import makeWASocket, {
  DisconnectReason,
  extractMessageContent,
  fetchLatestBaileysVersion,
  getContentType,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  proto,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import NodeCache from "@cacheable/node-cache";
import { Boom } from "@hapi/boom";
import pino from "pino";
import { toDataURL } from "qrcode";
import path from "path";
import fs from "fs";
import EventEmitter from "events";

export interface WhatsAppMessage {
  from: string;
  replyJid: string;
  body: string;
  messageId: string;
  timestamp: number;
  isGroup: boolean;
  pushName?: string;
}

export type ConnectionStatus = "connecting" | "open" | "close" | "qr";

type MsgKey = proto.IMessageKey;

function messageStoreKey(key: MsgKey): string {
  return `${key.remoteJid ?? ""}|${key.id ?? ""}|${key.fromMe ? 1 : 0}`;
}

function pnToJid(pn: string): string {
  const raw = pn.trim();
  if (raw.includes("@")) return jidNormalizedUser(raw) || raw;
  const digits = raw.replace(/\D/g, "");
  return digits ? `${digits}@s.whatsapp.net` : raw;
}

function toSendJid(jid: string): string {
  if (!jid.includes("@")) return `${jid.replace(/\D/g, "")}@s.whatsapp.net`;
  if (isLidUser(jid)) return jid;
  return jidNormalizedUser(jid) || jid;
}

function shouldSkipJid(jid: string): boolean {
  return (
    isJidGroup(jid) ||
    isJidBroadcast(jid) ||
    isJidStatusBroadcast(jid) ||
    isJidNewsletter(jid) ||
    jid.endsWith("@bot")
  );
}

function resolveAddress(key: MsgKey, remoteJid: string, lidToPhone: Map<string, string>) {
  const extended = key as MsgKey & { senderPn?: string; participantPn?: string };
  const pn = extended.senderPn || extended.participantPn;
  if (pn) {
    const phoneJid = pnToJid(pn);
    return { from: phoneJid, replyJid: phoneJid };
  }

  const normalized = toSendJid(remoteJid);
  if (isLidUser(normalized)) {
    const mapped = lidToPhone.get(normalized);
    if (mapped) return { from: mapped, replyJid: mapped };
    return { from: normalized, replyJid: normalized };
  }

  return { from: normalized, replyJid: normalized };
}

function extractBody(message: proto.IMessage | null | undefined): string {
  const content = extractMessageContent(message ?? undefined);
  if (!content) return "";

  const type = getContentType(content);
  if (type === "conversation") return content.conversation?.trim() ?? "";
  if (type === "extendedTextMessage") return content.extendedTextMessage?.text?.trim() ?? "";

  const text =
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    content.buttonsResponseMessage?.selectedButtonId ??
    content.listResponseMessage?.singleSelectReply?.selectedRowId ??
    content.templateButtonReplyMessage?.selectedId ??
    "";

  if (text.trim()) return text.trim();
  if (content.imageMessage) return "[imagem]";
  if (content.videoMessage) return "[video]";
  if (content.audioMessage) return "[audio]";
  if (content.documentMessage) return "[documento]";
  if (content.stickerMessage) return "[sticker]";
  if (content.locationMessage || content.liveLocationMessage) return "[localizacao]";
  if (content.contactMessage || content.contactsArrayMessage) return "[contato]";
  return "";
}

function socketIsOpen(sock: WASocket | null): boolean {
  if (!sock) return false;
  const ws = (sock as { ws?: { readyState?: number } }).ws;
  if (!ws) return true;
  return ws.readyState === 1;
}

export class WhatsAppClient extends EventEmitter {
  private sock: WASocket | null = null;
  private boundSock: WASocket | null = null;
  private sessionPath: string;
  private logger = pino({
    level: process.env.WA_LOG_LEVEL?.trim() || "warn",
  });
  private messageStore = new Map<string, proto.IMessage>();
  private msgRetryCounterCache = new NodeCache({ stdTTL: 600, useClones: false });
  private seenInboundIds = new NodeCache({ stdTTL: 300, useClones: false });
  private lidToPhone = new Map<string, string>();
  public status: ConnectionStatus = "close";
  public lastQrDataUrl?: string;
  private connecting = false;

  constructor(
    private businessId: string,
    sessionsRoot: string
  ) {
    super();
    this.sessionPath = path.join(sessionsRoot, businessId);
    fs.mkdirSync(this.sessionPath, { recursive: true });
  }

  private tryEmitInbound(msg: WAMessage) {
    if (msg.key.fromMe) return;
    const rawJid = msg.key.remoteJid ?? "";
    if (!rawJid || shouldSkipJid(rawJid)) {
      console.log(`[wa:${this.businessId}] skip_jid ${rawJid}`);
      return;
    }

    const messageId = msg.key.id ?? "";
    if (messageId && this.seenInboundIds.has(messageId)) return;
    if (messageId) this.seenInboundIds.set(messageId, true);

    if (msg.message && messageId) {
      this.messageStore.set(messageStoreKey(msg.key), msg.message);
    }

    const body = extractBody(msg.message);
    if (!body) {
      const inner = msg.message ? getContentType(extractMessageContent(msg.message) ?? {}) : null;
      console.log(
        `[wa:${this.businessId}] empty_body jid=${rawJid} stub=${msg.messageStubType ?? "-"} type=${inner ?? "-"}`
      );
      return;
    }

    const { from, replyJid } = resolveAddress(msg.key, rawJid, this.lidToPhone);
    const parsed: WhatsAppMessage = {
      from,
      replyJid,
      body,
      messageId,
      timestamp: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
      isGroup: !!isJidGroup(rawJid),
      pushName: msg.pushName ?? undefined,
    };

    console.log(
      `[wa:${this.businessId}] inbound from=${parsed.from} reply=${parsed.replyJid} text=${parsed.body.slice(0, 80)}`
    );
    this.emit("message", parsed);
  }

  private bindSocketEvents(saveCreds: () => Promise<void>) {
    if (!this.sock || this.boundSock === this.sock) return;
    this.boundSock = this.sock;

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on("chats.phoneNumberShare", ({ lid, jid }) => {
      const lidJid = toSendJid(lid);
      const phoneJid = pnToJid(jid);
      if (lidJid && phoneJid) {
        this.lidToPhone.set(lidJid, phoneJid);
        console.log(`[wa:${this.businessId}] lid_map ${lidJid} -> ${phoneJid}`);
      }
    });

    this.sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.status = "qr";
        const qrDataUrl = await toDataURL(qr);
        this.lastQrDataUrl = qrDataUrl;
        this.emit("qr", qrDataUrl);
      }

      if (connection === "open") {
        this.status = "open";
        this.lastQrDataUrl = undefined;
        this.connecting = false;
        console.log(`[wa:${this.businessId}] connected`);
        this.emit("connected");
      }

      if (connection === "close") {
        this.status = "close";
        this.connecting = false;
        this.boundSock = null;
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;
        console.log(`[wa:${this.businessId}] disconnected code=${code ?? "-"} reconnect=${shouldReconnect}`);
        this.emit("disconnected", { code, shouldReconnect });
        if (shouldReconnect) {
          setTimeout(() => {
            void this.connect().catch(() => undefined);
          }, 2500);
        }
      }
    });

    this.sock.ev.on("messages.upsert", ({ messages, type }) => {
      console.log(`[wa:${this.businessId}] upsert type=${type} count=${messages.length}`);
      for (const msg of messages) this.tryEmitInbound(msg);
    });

    this.sock.ev.on("messages.update", (updates) => {
      for (const { key, update } of updates) {
        if (!key?.remoteJid || key.fromMe || !update.message) continue;
        this.tryEmitInbound({ key, message: update.message, messageTimestamp: Date.now() / 1000 });
      }
    });
  }

  async connect() {
    if (this.isConnected()) return;
    if (this.connecting) return;
    this.connecting = true;
    this.status = "connecting";
    try {
      if (this.sock) {
        try {
          this.sock.end(undefined);
        } catch {
          /* ignore */
        }
        this.sock = null;
        this.boundSock = null;
        this.status = "close";
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
      let version: [number, number, number];
      try {
        const latest = await fetchLatestBaileysVersion();
        version = latest.version as [number, number, number];
      } catch {
        version = [2, 3000, 1015901307];
      }

      this.sock = makeWASocket({
        version,
        logger: this.logger as any,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger as any),
        },
        printQRInTerminal: false,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: false,
        shouldSyncHistoryMessage: () => false,
        msgRetryCounterCache: this.msgRetryCounterCache as any,
        getMessage: async (key) => this.messageStore.get(messageStoreKey(key)),
      });

      this.bindSocketEvents(saveCreds);
    } catch (err) {
      this.connecting = false;
      this.status = "close";
      throw err;
    }
  }

  async sendText(to: string, text: string): Promise<string | undefined> {
    if (!this.sock) throw new Error("Socket not connected");
    const jid = toSendJid(to);
    const result = await this.sock.sendMessage(jid, { text });
    return result?.key.id ?? undefined;
  }

  async sendImage(to: string, imageUrl: string, caption?: string): Promise<string | undefined> {
    if (!this.sock) throw new Error("Socket not connected");
    const jid = toSendJid(to);
    const result = await this.sock.sendMessage(jid, {
      image: { url: imageUrl },
      caption,
    });
    return result?.key.id ?? undefined;
  }

  async logout() {
    await this.sock?.logout();
    this.sock = null;
    this.boundSock = null;
    this.status = "close";
    this.messageStore.clear();
    this.lidToPhone.clear();
    fs.rmSync(this.sessionPath, { recursive: true, force: true });
  }

  isConnected(): boolean {
    return this.status === "open" && !!this.sock;
  }

  getDebugInfo() {
    return {
      businessId: this.businessId,
      status: this.status,
      socketOpen: socketIsOpen(this.sock),
      messageHandlers: this.listenerCount("message"),
      lidMappings: this.lidToPhone.size,
    };
  }
}

export class WhatsAppManager {
  private clients = new Map<string, WhatsAppClient>();

  getOrCreate(businessId: string, sessionsRoot: string): WhatsAppClient {
    if (!this.clients.has(businessId)) {
      const client = new WhatsAppClient(businessId, sessionsRoot);
      this.clients.set(businessId, client);
    }
    return this.clients.get(businessId)!;
  }

  get(businessId: string): WhatsAppClient | undefined {
    return this.clients.get(businessId);
  }

  remove(businessId: string) {
    this.clients.delete(businessId);
  }

  all(): Map<string, WhatsAppClient> {
    return this.clients;
  }
}
