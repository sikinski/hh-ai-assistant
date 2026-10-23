-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Vacancy" (
    "id" SERIAL NOT NULL,
    "hhId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "company" TEXT,
    "area" TEXT,
    "salary" TEXT,
    "experience" TEXT,
    "workFormat" TEXT,
    "employment" TEXT,
    "responsesCount" INTEGER,
    "letterRequired" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "keySkills" TEXT[],
    "isRelevant" BOOLEAN,
    "matchScore" INTEGER,
    "aiReason" TEXT,
    "requirements" TEXT,
    "coverLetter" TEXT,
    "analyzeErrors" INTEGER NOT NULL DEFAULT 0,
    "notifiedAt" TIMESTAMP(3),
    "isSkipped" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vacancy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vacancy_hhId_key" ON "Vacancy"("hhId");

-- CreateIndex
CREATE INDEX "Vacancy_isRelevant_isSkipped_idx" ON "Vacancy"("isRelevant", "isSkipped");

