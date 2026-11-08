-- Fichiers de production MLA (flotte, activités) conservés par mois pour la traçabilité.
CREATE TABLE "MlaFile" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedBy" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MlaFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MlaFile_month_idx" ON "MlaFile"("month");
