import { FastifyRequest, FastifyReply } from "fastify";
import { getAdminAuth, hasAdminCredential } from "@flowdesk/firebase";

declare module "fastify" {
  interface FastifyRequest {
    tenantId: string;
    tenantEmail?: string;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!hasAdminCredential()) {
    return reply.status(503).send({
      error:
        "API sem credencial Firebase Admin. No Render, configure FIREBASE_SERVICE_ACCOUNT_JSON (JSON completo da service account).",
    });
  }

  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    if (decoded.email_verified !== true) {
      return reply.status(403).send({ error: "Confirme seu e-mail antes de acessar o painel." });
    }
    request.tenantId = decoded.uid;
    request.tenantEmail = decoded.email;
  } catch (err) {
    const code = (err as { code?: string }).code;
    request.log.warn({ err, code }, "verifyIdToken failed");
    if (code === "EACCES") {
      return reply.status(503).send({
        error:
          "API sem permissão para ler .secrets/firebase-adminsdk.json. Na VM: chmod 755 .secrets && chmod 644 .secrets/firebase-adminsdk.json && docker compose -f docker-compose.prod.yml up -d api",
      });
    }
    if (code === "auth/id-token-expired") {
      return reply.status(401).send({ error: "Sessão expirada. Saia e entre novamente." });
    }
    if (code === "auth/id-token-revoked") {
      return reply.status(401).send({ error: "Sessão revogada. Saia e entre novamente." });
    }
    if (code === "app/invalid-credential" || code === "auth/invalid-credential") {
      return reply.status(503).send({
        error: "Credencial Firebase Admin inválida no servidor. Revise FIREBASE_SERVICE_ACCOUNT_JSON.",
      });
    }
    return reply.status(401).send({ error: "Token inválido. Saia e entre novamente." });
  }
}
