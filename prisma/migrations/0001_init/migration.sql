-- CreateEnum
CREATE TYPE "Profile" AS ENUM ('ADMINISTRATEUR', 'DIRECTION', 'EQUIPE_FACTURATION', 'CHARGE_FACTURATION', 'COMPTABLE', 'RH', 'PARTENAIRE');

-- CreateEnum
CREATE TYPE "Module" AS ENUM ('DASH', 'PILOT', 'QC', 'FCLI', 'FFOUR', 'PART', 'FACT', 'CAAR', 'BDG', 'DP', 'VIR', 'RELEVE', 'RH');

-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('NONE', 'VIEW', 'EDIT');

-- CreateEnum
CREATE TYPE "Sens" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('EN_ATTENTE', 'REGLE', 'ANNULE');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('VIREMENT', 'CHEQUE', 'VERSEMENT', 'AUTRE');

-- CreateEnum
CREATE TYPE "StatementStatus" AS ENUM ('A_TRAITER', 'RAPPROCHE', 'DEJA', 'IGNORE', 'AJOUTE');

-- CreateEnum
CREATE TYPE "HrSens" AS ENUM ('PAIEMENT', 'RETOUR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL DEFAULT '',
    "profile" "Profile" NOT NULL DEFAULT 'CHARGE_FACTURATION',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserModuleAccess" (
    "userId" TEXT NOT NULL,
    "module" "Module" NOT NULL,
    "level" "AccessLevel" NOT NULL,

    CONSTRAINT "UserModuleAccess_pkey" PRIMARY KEY ("userId","module")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "sens" "Sens" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'EN_ATTENTE',
    "categorie" TEXT NOT NULL DEFAULT '',
    "tiers" TEXT NOT NULL DEFAULT '',
    "numero" TEXT NOT NULL DEFAULT '',
    "libelle" TEXT NOT NULL DEFAULT '',
    "montant" DECIMAL(14,2) NOT NULL,
    "montantGlobal" DECIMAL(14,2),
    "dateOperation" DATE,
    "dateFacture" DATE,
    "annee" INTEGER,
    "mode" "PaymentMode",
    "cheque" TEXT NOT NULL DEFAULT '',
    "banque" TEXT NOT NULL DEFAULT '',
    "nature" TEXT NOT NULL DEFAULT '',
    "classe" INTEGER,
    "succursale" TEXT NOT NULL DEFAULT '',
    "periode" TEXT NOT NULL DEFAULT '',
    "debours" DECIMAL(14,2),
    "frais" DECIMAL(14,2),
    "paymentRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "origine" TEXT NOT NULL DEFAULT '',
    "ordre" DOUBLE PRECISION,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "payroll" BOOLEAN NOT NULL DEFAULT false,
    "extra" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementLine" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "libelle" TEXT NOT NULL DEFAULT '',
    "montant" DECIMAL(14,2) NOT NULL,
    "sens" "Sens" NOT NULL,
    "numero" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT '',
    "status" "StatementStatus" NOT NULL DEFAULT 'A_TRAITER',
    "invoiceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extra" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "BankStatementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "num" INTEGER NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "beneficiaire" TEXT NOT NULL DEFAULT '',
    "adresse" TEXT NOT NULL DEFAULT '',
    "date" DATE,
    "mode" TEXT NOT NULL DEFAULT '',
    "montant" DECIMAL(14,2) NOT NULL,
    "nature" TEXT NOT NULL DEFAULT '',
    "produit" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "pieces" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invoiceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "extra" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuedInvoice" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "num" TEXT NOT NULL DEFAULT '',
    "client" TEXT NOT NULL DEFAULT '',
    "date" DATE,
    "ht" DECIMAL(14,2) NOT NULL,
    "tva" DECIMAL(14,2) NOT NULL,
    "ttc" DECIMAL(14,2) NOT NULL,
    "objet" TEXT NOT NULL DEFAULT '',
    "invoiceLegacyId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssuedInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaarProduction" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "annee" INTEGER NOT NULL,
    "mois" INTEGER NOT NULL,
    "succursale" TEXT NOT NULL DEFAULT '',
    "fichier" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CaarProduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaarProductionChunk" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "k" INTEGER NOT NULL,
    "rows" JSONB NOT NULL,

    CONSTRAINT "CaarProductionChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderRib" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "code" TEXT NOT NULL DEFAULT '',
    "key" TEXT NOT NULL DEFAULT '',
    "rib" TEXT NOT NULL,
    "noms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wilaya" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'actif',
    "origine" TEXT NOT NULL DEFAULT '',
    "extra" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderRib_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferBatch" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "ref" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT '',
    "annee" INTEGER,
    "mois" TEXT NOT NULL DEFAULT '',
    "fichier" TEXT NOT NULL DEFAULT '',
    "debit" DECIMAL(14,2) NOT NULL,
    "credit" DECIMAL(14,2) NOT NULL,
    "nb" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT '',
    "verdict" TEXT NOT NULL DEFAULT '',
    "lines" JSONB NOT NULL DEFAULT '[]',
    "extra" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrEntry" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "date" DATE,
    "annee" INTEGER,
    "mois" TEXT NOT NULL DEFAULT '',
    "beneficiaire" TEXT NOT NULL DEFAULT '',
    "libelle" TEXT NOT NULL DEFAULT '',
    "montant" DECIMAL(14,2) NOT NULL,
    "sens" "HrSens" NOT NULL,
    "nature" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL DEFAULT '',
    "banque" TEXT NOT NULL DEFAULT '',
    "cheque" TEXT NOT NULL DEFAULT '',
    "classe" INTEGER,
    "ordre" DOUBLE PRECISION,
    "origine" TEXT NOT NULL DEFAULT '',
    "categorieOrigine" TEXT NOT NULL DEFAULT '',
    "extra" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HrEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT NOT NULL,
    "partenaire" TEXT NOT NULL DEFAULT '',
    "montant" DECIMAL(14,2) NOT NULL,
    "nb" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "legacyId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "userName" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "objet" TEXT NOT NULL DEFAULT '',
    "admin" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_profile_idx" ON "User"("profile");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_legacyId_key" ON "Invoice"("legacyId");

-- CreateIndex
CREATE INDEX "Invoice_sens_status_idx" ON "Invoice"("sens", "status");

-- CreateIndex
CREATE INDEX "Invoice_categorie_idx" ON "Invoice"("categorie");

-- CreateIndex
CREATE INDEX "Invoice_tiers_idx" ON "Invoice"("tiers");

-- CreateIndex
CREATE INDEX "Invoice_annee_idx" ON "Invoice"("annee");

-- CreateIndex
CREATE INDEX "Invoice_dateOperation_idx" ON "Invoice"("dateOperation");

-- CreateIndex
CREATE INDEX "Invoice_payroll_idx" ON "Invoice"("payroll");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementLine_legacyId_key" ON "BankStatementLine"("legacyId");

-- CreateIndex
CREATE INDEX "BankStatementLine_date_idx" ON "BankStatementLine"("date");

-- CreateIndex
CREATE INDEX "BankStatementLine_status_idx" ON "BankStatementLine"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_legacyId_key" ON "PaymentRequest"("legacyId");

-- CreateIndex
CREATE INDEX "PaymentRequest_num_idx" ON "PaymentRequest"("num");

-- CreateIndex
CREATE INDEX "PaymentRequest_beneficiaire_idx" ON "PaymentRequest"("beneficiaire");

-- CreateIndex
CREATE UNIQUE INDEX "IssuedInvoice_legacyId_key" ON "IssuedInvoice"("legacyId");

-- CreateIndex
CREATE INDEX "IssuedInvoice_client_idx" ON "IssuedInvoice"("client");

-- CreateIndex
CREATE UNIQUE INDEX "CaarProduction_legacyId_key" ON "CaarProduction"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "CaarProductionChunk_productionId_k_key" ON "CaarProductionChunk"("productionId", "k");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderRib_legacyId_key" ON "ProviderRib"("legacyId");

-- CreateIndex
CREATE INDEX "ProviderRib_rib_idx" ON "ProviderRib"("rib");

-- CreateIndex
CREATE INDEX "ProviderRib_key_idx" ON "ProviderRib"("key");

-- CreateIndex
CREATE UNIQUE INDEX "TransferBatch_legacyId_key" ON "TransferBatch"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "HrEntry_legacyId_key" ON "HrEntry"("legacyId");

-- CreateIndex
CREATE INDEX "HrEntry_annee_idx" ON "HrEntry"("annee");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_legacyId_key" ON "Reminder"("legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_legacyId_key" ON "JournalEntry"("legacyId");

-- CreateIndex
CREATE INDEX "JournalEntry_at_idx" ON "JournalEntry"("at");

-- CreateIndex
CREATE INDEX "JournalEntry_admin_at_idx" ON "JournalEntry"("admin", "at");

-- AddForeignKey
ALTER TABLE "UserModuleAccess" ADD CONSTRAINT "UserModuleAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaarProductionChunk" ADD CONSTRAINT "CaarProductionChunk_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "CaarProduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
