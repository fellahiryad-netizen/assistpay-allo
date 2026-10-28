import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Variables d'environnement validées au démarrage.
 * Toute lecture de configuration passe par ce module (jamais `process.env` directement).
 */
export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET doit contenir au moins 32 caractères."),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  },
  client: {},
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    SESSION_TTL_HOURS: process.env.SESSION_TTL_HOURS,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
    NODE_ENV: process.env.NODE_ENV,
  },
  skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
  emptyStringAsUndefined: true,
});
