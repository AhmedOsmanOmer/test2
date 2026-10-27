-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'COMMITTED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "OrderItemImport" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "rows" JSONB NOT NULL,
    "errors" JSONB NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderItemImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderItemImport_orderId_fileSha256_idx" ON "OrderItemImport"("orderId", "fileSha256");

-- CreateIndex
CREATE INDEX "OrderItemImport_uploadedById_createdAt_idx" ON "OrderItemImport"("uploadedById", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderItemImport" ADD CONSTRAINT "OrderItemImport_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemImport" ADD CONSTRAINT "OrderItemImport_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
