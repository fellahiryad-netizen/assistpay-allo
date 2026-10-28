import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

/** Crée le client Prisma relié à PostgreSQL via le pilote `pg`. */
function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({ adapter, log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
}

const globalForPrisma = globalThis as unknown as { assistpayPrisma?: PrismaClient };

/** Client Prisma unique pour tout le processus (réutilisé entre les rechargements en développement). */
export const db: PrismaClient = globalForPrisma.assistpayPrisma ?? createClient();

if (env.NODE_ENV !== "production") globalForPrisma.assistpayPrisma = db;
