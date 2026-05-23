-- Create enum for reservas status
CREATE TYPE "EstadoReserva" AS ENUM ('PENDIENTE', 'CONFIRMADA', 'CANCELADA');

-- Create reservas table
CREATE TABLE "Reserva" (
  "id" SERIAL NOT NULL,
  "empresaId" INTEGER NOT NULL,
  "sedeId" INTEGER NOT NULL,
  "productoId" INTEGER NOT NULL,
  "cantidad" INTEGER NOT NULL,
  "motivo" TEXT,
  "estado" "EstadoReserva" NOT NULL DEFAULT 'PENDIENTE',
  "fechaVencimiento" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Reserva_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Reserva"
ADD CONSTRAINT "Reserva_empresaId_fkey"
FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Reserva"
ADD CONSTRAINT "Reserva_sedeId_fkey"
FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Reserva"
ADD CONSTRAINT "Reserva_productoId_fkey"
FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Reserva_empresaId_sedeId_estado_idx" ON "Reserva"("empresaId", "sedeId", "estado");
CREATE INDEX "Reserva_productoId_idx" ON "Reserva"("productoId");
