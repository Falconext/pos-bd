-- CreateTable
CREATE TABLE "PlanSubModulo" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "subModuloId" INTEGER NOT NULL,

    CONSTRAINT "PlanSubModulo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanSubModulo_planId_subModuloId_key" ON "PlanSubModulo"("planId", "subModuloId");

-- CreateIndex
CREATE INDEX "PlanSubModulo_planId_idx" ON "PlanSubModulo"("planId");

-- CreateIndex
CREATE INDEX "PlanSubModulo_subModuloId_idx" ON "PlanSubModulo"("subModuloId");

-- AddForeignKey
ALTER TABLE "PlanSubModulo" ADD CONSTRAINT "PlanSubModulo_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanSubModulo" ADD CONSTRAINT "PlanSubModulo_subModuloId_fkey" FOREIGN KEY ("subModuloId") REFERENCES "SubModulo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
