import "dotenv/config";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { authRoutes } from "./routes/auth.js";
import { incidentRoutes } from "./routes/incidents.js";
import { responseRoutes } from "./routes/response.js";

const app = Fastify({
  logger: true,
  trustProxy: true
});

await app.register(helmet);
await app.register(cookie);
await app.register(rateLimit, { global: false });

await app.register(cors, {
  origin: process.env.SIGDEC_PUBLIC_URL ?? "http://localhost:3000",
  credentials: true
});

app.get("/health", async () => ({
  status: "ok",
  service: "sigdec-api",
  version: "0.4.0",
  timestamp: new Date().toISOString()
}));

await app.register(authRoutes);
await app.register(incidentRoutes);
await app.register(responseRoutes);

app.get("/api/v1", async () => ({
  name: "SIGDEC API",
  version: "v1",
  release: "0.4.0",
  modules: [
    "auth", "ocorrencias", "despacho", "riscos", "monitoramento",
    "vistorias", "documentos", "desastres", "assistencia-humanitaria",
    "voluntariado", "logistica", "comunicacoes", "auditoria"
  ]
}));

await app.listen({
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0"
});
