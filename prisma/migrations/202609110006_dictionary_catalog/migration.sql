-- CreateTable
CREATE TABLE "DictionaryEntry" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL DEFAULT '',
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT NOT NULL DEFAULT '',
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DictionaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DictionaryTerm" (
    "kind" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "entryId" UUID NOT NULL,

    CONSTRAINT "DictionaryTerm_pkey" PRIMARY KEY ("kind","normalized")
);

-- CreateTable
CREATE TABLE "ItemDictionarySelection" (
    "itemId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "entryId" UUID NOT NULL,
    "entryVersion" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemDictionarySelection_pkey" PRIMARY KEY ("itemId","kind")
);

-- CreateIndex
CREATE INDEX "DictionaryEntry_kind_active_sortOrder_idx" ON "DictionaryEntry"("kind", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "DictionaryEntry_kind_code_key" ON "DictionaryEntry"("kind", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DictionaryEntry_id_kind_key" ON "DictionaryEntry"("id", "kind");

-- CreateIndex
CREATE INDEX "DictionaryTerm_entryId_kind_idx" ON "DictionaryTerm"("entryId", "kind");

-- CreateIndex
CREATE INDEX "ItemDictionarySelection_entryId_kind_idx" ON "ItemDictionarySelection"("entryId", "kind");

-- AddForeignKey
ALTER TABLE "DictionaryTerm" ADD CONSTRAINT "DictionaryTerm_entryId_kind_fkey" FOREIGN KEY ("entryId", "kind") REFERENCES "DictionaryEntry"("id", "kind") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ItemDictionarySelection" ADD CONSTRAINT "ItemDictionarySelection_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemDictionarySelection" ADD CONSTRAINT "ItemDictionarySelection_entryId_kind_fkey" FOREIGN KEY ("entryId", "kind") REFERENCES "DictionaryEntry"("id", "kind") ON DELETE RESTRICT ON UPDATE RESTRICT;

