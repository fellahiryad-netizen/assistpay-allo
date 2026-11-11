-- Journal : état avant / après d'une modification (colonnes facultatives, rien n'est retiré).
ALTER TABLE "JournalEntry" ADD COLUMN "entity" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN "entityId" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN "avant" JSONB;
ALTER TABLE "JournalEntry" ADD COLUMN "apres" JSONB;
CREATE INDEX "JournalEntry_entity_entityId_idx" ON "JournalEntry"("entity", "entityId");

-- Affectations : une ligne par (ligne du relevé, facture, partie), avec le montant affecté.
-- Tenue à jour automatiquement depuis BankStatementLine."invoiceRefs" (déclencheur) : rien ne change dans les écrans.
CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "invoiceLegacyId" TEXT NOT NULL,
    "part" TEXT NOT NULL DEFAULT 'tout',
    "montant" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Allocation_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "BankStatementLine"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Allocation_line_invoice_part_key" ON "Allocation"("lineId", "invoiceLegacyId", "part");
CREATE INDEX "Allocation_invoiceLegacyId_idx" ON "Allocation"("invoiceLegacyId");
ALTER TABLE "Allocation" ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION sync_allocations() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  DELETE FROM "Allocation" WHERE "lineId" = NEW."id";
  INSERT INTO "Allocation" ("id", "lineId", "invoiceLegacyId", "part", "montant")
  SELECT gen_random_uuid()::text, NEW."id", t.legacy, t.part,
         CASE t.part WHEN 'debours' THEN i."debours" WHEN 'frais' THEN i."frais" ELSE i."montant" END
  FROM (
    SELECT DISTINCT split_part(r, ':', 1) AS legacy, COALESCE(NULLIF(split_part(r, ':', 2), ''), 'tout') AS part
    FROM unnest(NEW."invoiceRefs") AS r
    WHERE split_part(r, ':', 1) <> '' AND split_part(r, ':', 1) NOT LIKE 'rh%'
  ) t
  LEFT JOIN "Invoice" i ON i."legacyId" = t.legacy;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BankStatementLine_sync_allocations"
AFTER INSERT OR UPDATE OF "invoiceRefs" ON "BankStatementLine"
FOR EACH ROW EXECUTE FUNCTION sync_allocations();

-- Reprise de l'existant.
INSERT INTO "Allocation" ("id", "lineId", "invoiceLegacyId", "part", "montant")
SELECT gen_random_uuid()::text, l."id", t.legacy, t.part,
       CASE t.part WHEN 'debours' THEN i."debours" WHEN 'frais' THEN i."frais" ELSE i."montant" END
FROM "BankStatementLine" l
CROSS JOIN LATERAL (
  SELECT DISTINCT split_part(r, ':', 1) AS legacy, COALESCE(NULLIF(split_part(r, ':', 2), ''), 'tout') AS part
  FROM unnest(l."invoiceRefs") AS r
  WHERE split_part(r, ':', 1) <> '' AND split_part(r, ':', 1) NOT LIKE 'rh%'
) t
LEFT JOIN "Invoice" i ON i."legacyId" = t.legacy;
