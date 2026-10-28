/**
 * Gestion des comptes en ligne de commande (utile pour le premier mot de passe de l'administrateur).
 *
 *   npm run user -- lister
 *   npm run user -- motdepasse <email> <mot de passe>
 *   npm run user -- ajouter <email> "<Prénom>" "<NOM>" <PROFIL> <mot de passe>
 *   npm run user -- desactiver <email>   |   reactiver <email>
 *
 * Profils : ADMINISTRATEUR, DIRECTION, EQUIPE_FACTURATION, CHARGE_FACTURATION, COMPTABLE, RH, PARTENAIRE
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PROFILE_KEYS } from "@/features/access/types";
import { hashPassword } from "@/lib/password";
import { createScriptClient } from "./script-db";

const email = z.string().trim().toLowerCase().email("Adresse e-mail invalide.");
const password = z.string().min(10, "Mot de passe trop court (10 caractères minimum).");

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const db = createScriptClient();
  try {
    if (!command || command === "lister") {
      const users = await db.user.findMany({ orderBy: { email: "asc" } });
      console.table(
        users.map((user) => ({
          email: user.email,
          nom: `${user.firstName} ${user.lastName}`.trim(),
          profil: user.profile,
          motDePasse: user.passwordHash ? "défini" : "À DÉFINIR",
          etat: user.active ? "actif" : "désactivé",
        })),
      );
      return;
    }
    if (command === "ajouter") {
      const input = z
        .tuple([email, z.string().trim().min(1), z.string().trim().min(1), z.enum(PROFILE_KEYS), password])
        .parse(args.slice(0, 5));
      const [mail, firstName, lastName, profile, secret] = input;
      await db.user.create({
        data: { id: `u_${randomUUID().replace(/-/g, "").slice(0, 22)}`, email: mail, firstName, lastName: lastName.toUpperCase(), profile, passwordHash: await hashPassword(secret) },
      });
      console.log(`Compte créé : ${mail}`);
      return;
    }
    const mail = email.parse(args[0]);
    const user = await db.user.findUnique({ where: { email: mail } });
    if (!user) throw new Error(`Compte introuvable : ${mail}`);
    if (command === "motdepasse") {
      await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password.parse(args[1])) } });
      console.log("Mot de passe enregistré.");
    } else if (command === "desactiver" || command === "reactiver") {
      await db.user.update({ where: { id: user.id }, data: { active: command === "reactiver" } });
      console.log(command === "reactiver" ? "Compte réactivé." : "Compte désactivé.");
    } else {
      throw new Error(`Commande inconnue : ${command}`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof z.ZodError ? error.issues.map((issue) => issue.message).join("\n") : error instanceof Error ? error.message : error);
  process.exit(1);
});
