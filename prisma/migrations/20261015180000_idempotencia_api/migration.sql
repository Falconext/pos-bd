-- Idempotencia de la API pública: que un reintento no emita dos facturas.
--
-- Es el riesgo número uno de abrir la facturación por API. Si el integrador
-- pierde la respuesta —timeout, 502 de un proxy, su proceso que muere— va a
-- reintentar; sin esto el reintento emite una SEGUNDA factura: las dos válidas
-- ante SUNAT, las dos con su correlativo, y deshacer una exige una
-- comunicación de baja.
--
-- El índice único (empresaId, clave) es la pieza de seguridad, no una
-- optimización: es lo que hace que dos requests simultáneos con la misma clave
-- colisionen en la base y solo uno ejecute. Sin él, dos reintentos que llegan
-- en el mismo milisegundo pasan los dos.
--
-- No toca ninguna tabla existente: solo agrega esta.

CREATE TABLE "IdempotenciaApi" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "clave" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "estadoHttp" INTEGER,
    "respuesta" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotenciaApi_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IdempotenciaApi_empresaId_clave_key" ON "IdempotenciaApi"("empresaId", "clave");

-- Para la limpieza periódica de claves vencidas.
CREATE INDEX "IdempotenciaApi_expiraEn_idx" ON "IdempotenciaApi"("expiraEn");

ALTER TABLE "IdempotenciaApi" ADD CONSTRAINT "IdempotenciaApi_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
