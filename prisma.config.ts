import "dotenv/config";
import { defineConfig } from "prisma/config";

// Prisma 7 ne lit plus .env tout seul : dotenv le charge ci-dessus.
// `prisma generate` n'a pas besoin de la base ; l'adresse factice ne sert qu'à lui permettre de démarrer
// sans .env (installation, CI). `migrate deploy` exige, lui, la vraie DATABASE_URL.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder" },
});
