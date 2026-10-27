-- AlterEnum
ALTER TYPE "AttachmentKind" ADD VALUE 'DELIVERY_PROOF';

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "deliveryId" TEXT;

-- CreateIndex
CREATE INDEX "Attachment_deliveryId_idx" ON "Attachment"("deliveryId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE SET NULL ON UPDATE CASCADE;
