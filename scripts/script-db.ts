import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { z } from "zod";
import { PrismaClient } from "@/generated/prisma/client";

/** Variables nécessaires aux scripts d'administration (lancés hors de Next.js). */
const scriptEnv = z.object({ DATABASE_URL: z.string().url("DATABASE_URL manquante ou invalide dans .env") }).parse(process.env);

/** Client Prisma pour les scripts en ligne de commande. */
export function createScriptClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: scriptEnv.DATABASE_URL }) });
}
