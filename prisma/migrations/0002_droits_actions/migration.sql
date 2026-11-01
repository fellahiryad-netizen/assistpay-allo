-- Droits par onglet et par action (boutons) : alertes, historique, prestataires, vérification BDG GAM, barème CAAR,
-- exports, imports, rectification et demande de suppression.
ALTER TYPE "Module" ADD VALUE IF NOT EXISTS 'ALERT';
ALTER TYPE "Module" ADD VALUE IF NOT EXISTS 'HIST';
ALTER TYPE "Module" ADD VALUE IF NOT EXISTS 'PREST';
ALTER TYPE "Module" ADD VALUE IF NOT EXISTS 'BDGV';
ALTER TYPE "Module" ADD VALUE IF NOT EXISTS 'CAARB';
ALTER TYPE "Module" ADD VALUE IF NOT EXISTS 'A_EXPORT';
ALTER TYPE "Module" ADD VALUE IF NOT EXISTS 'A_IMPORT';
ALTER TYPE "Module" ADD VALUE IF NOT EXISTS 'A_RECT';
ALTER TYPE "Module" ADD VALUE IF NOT EXISTS 'A_SUPPR';
