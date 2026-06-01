-- Migration: add FIRS reference data tables

CREATE TABLE IF NOT EXISTS "invoice_types" (
  "code"      TEXT NOT NULL,
  "value"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_types_pkey" PRIMARY KEY ("code")
);

CREATE TABLE IF NOT EXISTS "payment_means" (
  "code"      TEXT NOT NULL,
  "value"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_means_pkey" PRIMARY KEY ("code")
);

CREATE TABLE IF NOT EXISTS "tax_categories" (
  "code"      TEXT NOT NULL,
  "value"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_categories_pkey" PRIMARY KEY ("code")
);

CREATE TABLE IF NOT EXISTS "currencies" (
  "code"          TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "symbol"        TEXT NOT NULL,
  "symbolNative"  TEXT NOT NULL,
  "decimalDigits" INTEGER NOT NULL DEFAULT 2,
  "rounding"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "namePlural"    TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

CREATE TABLE IF NOT EXISTS "hs_codes" (
  "code"        TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hs_codes_pkey" PRIMARY KEY ("code")
);

CREATE INDEX IF NOT EXISTS "hs_codes_description_idx" ON "hs_codes"("description");

CREATE TABLE IF NOT EXISTS "service_codes" (
  "code"        TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_codes_pkey" PRIMARY KEY ("code")
);

CREATE INDEX IF NOT EXISTS "service_codes_description_idx" ON "service_codes"("description");

CREATE TABLE IF NOT EXISTS "nigerian_states" (
  "code"      TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nigerian_states_pkey" PRIMARY KEY ("code")
);

CREATE TABLE IF NOT EXISTS "lgas" (
  "code"      TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "stateCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lgas_pkey" PRIMARY KEY ("code")
);

CREATE INDEX IF NOT EXISTS "lgas_stateCode_idx" ON "lgas"("stateCode");

ALTER TABLE "lgas" ADD CONSTRAINT "lgas_stateCode_fkey"
  FOREIGN KEY ("stateCode") REFERENCES "nigerian_states"("code")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "countries" (
  "alpha2"      TEXT NOT NULL,
  "alpha3"      TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "countryCode" TEXT NOT NULL,
  "region"      TEXT,
  "subRegion"   TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "countries_pkey" PRIMARY KEY ("alpha2")
);

CREATE INDEX IF NOT EXISTS "countries_name_idx" ON "countries"("name");

CREATE TABLE IF NOT EXISTS "quantity_codes" (
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quantity_codes_pkey" PRIMARY KEY ("code")
);
