# AssistPay : consignes pour l'IA

Avant toute modification, lire :
1. `docs/ai_system_rules.md` : règles d'architecture obligatoires ;
2. `docs/ASSISTPAY_CONTEXTE.md` : métier, accès, modèle de données, feuille de route.

## Rappels essentiels

- Interface et messages en français. Montants en DA, deux décimales. Fuseau horaire : Africa/Algiers.
- Base de données : uniquement depuis `src/features/*/services/`. Chaque service vérifie l'accès (`requireAccess` / `requireAdmin`) et renvoie un `ActionResult<T>`.
- Server actions dans `src/app/actions/`, via `runAction` (session, validation Zod, try/catch) ou `runUploadAction` (fichier Excel/CSV contrôlé), puis `revalidatePath`.
- Téléchargements (Excel, JSON) : route handlers dans `src/app/api/`, qui appellent un service. Impressions : pages du groupe `src/app/(print)` avec `PrintToolbar`.
- Fichiers Excel : uniquement via `src/lib/spreadsheet.ts` (`readWorkbook`, `cellAt`, `writeWorkbook`).
- Champs de l'ancienne version non modélisés : JSON `extra` / `payload`, lus avec des fonctions tolérantes (`readExtra`) ; ne jamais supprimer un champ inconnu.
- Ne pas passer de fonction d'un composant serveur à un composant client (props sérialisables uniquement).
- Chaque nouveau dossier de route : `page.tsx`, `loading.tsx` et `error.tsx`.
- Pas de `any`, pas de `@ts-ignore`, pas de `process.env` hors de `src/lib/env.ts` et des scripts. JSDoc sur tout export.
- Toute modification métier écrit dans le journal (`logAction`).
- Schéma : modifier `prisma/schema.prisma` et ajouter une migration dans `prisma/migrations/` (`npx prisma migrate dev --name …` sur un poste qui a accès à Internet).
- Avant de livrer : `npm run typecheck` puis `npm run build`.

## Commandes

```bash
npm install                 # installe et génère le client Prisma
npm run db:migrate          # applique les migrations
npm run db:import -- data/db.json --comptes config/comptes.json
npm run user -- motdepasse prenom.nom@alloassistance.dz "MotDePasseSolide"
npm run dev                 # développement, http://localhost:3000
npm run build && npm start  # production
```
