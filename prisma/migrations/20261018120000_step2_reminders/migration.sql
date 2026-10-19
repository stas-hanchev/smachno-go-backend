-- AlterTable
ALTER TABLE `orders` ADD COLUMN `reminder_sent_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `orders_status_pickup_start_idx` ON `orders`(`status`, `pickup_start`);
