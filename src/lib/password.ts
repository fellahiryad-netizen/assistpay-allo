import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (password: string, salt: string, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

/**
 * Hache un mot de passe au format `scrypt$<sel hex>$<hash hex>`.
 * Format identique à celui de l'ancienne version serveur (config/comptes.json), ce qui permet de
 * reprendre les mots de passe existants sans les redemander.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

/** Vérifie un mot de passe contre un hash `scrypt$sel$hash`, en temps constant. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== KEY_LENGTH) return false;
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return timingSafeEqual(derived, expected);
}
