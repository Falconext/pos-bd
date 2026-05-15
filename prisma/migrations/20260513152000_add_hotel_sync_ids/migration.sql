ALTER TABLE "Empresa"
ADD COLUMN "hotelTenantId" TEXT,
ADD COLUMN "hotelAdminUserId" TEXT,
ADD COLUMN "hotelSyncAt" TIMESTAMP(3);
