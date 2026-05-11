-- CreateEnum
CREATE TYPE "public"."EstadoCompra" AS ENUM ('REGISTRADO', 'ANULADO');

-- AlterEnum
ALTER TYPE "public"."Rol" ADD VALUE 'RESELLER';

-- AlterTable
ALTER TABLE "public"."Categoria" ADD COLUMN     "imagenUrl" TEXT;

-- AlterTable
ALTER TABLE "public"."Comprobante" ADD COLUMN     "cotizAdelanto" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "cotizDescuento" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "cotizFirmante" TEXT,
ADD COLUMN     "cotizIncluirImagenes" BOOLEAN DEFAULT false,
ADD COLUMN     "cotizTerminos" TEXT,
ADD COLUMN     "cotizTipoPago" TEXT DEFAULT 'CONTADO',
ADD COLUMN     "cotizVigencia" INTEGER DEFAULT 7,
ADD COLUMN     "cuentaBancoNacion" TEXT,
ADD COLUMN     "cuotas" JSONB,
ADD COLUMN     "medioPagoDetraccionId" INTEGER,
ADD COLUMN     "montoDetraccion" DOUBLE PRECISION,
ADD COLUMN     "porcentajeDetraccion" DOUBLE PRECISION,
ADD COLUMN     "sedeId" INTEGER,
ADD COLUMN     "tipoDetraccionId" INTEGER,
ALTER COLUMN "fechaEmision" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "sunatCdrResponse" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "public"."Empresa" ADD COLUMN     "bancoNombre" TEXT,
ADD COLUMN     "cci" TEXT,
ADD COLUMN     "esAgenteRetencion" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "monedaCuenta" TEXT DEFAULT 'SOLES',
ADD COLUMN     "numeroCuenta" TEXT,
ADD COLUMN     "resellerId" INTEGER,
ADD COLUMN     "usaCodigoBarrasManual" BOOLEAN,
ADD COLUMN     "usaDemo" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "disenoOverride" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "public"."GastoSistema" ALTER COLUMN "actualizadoEn" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."GuiaRemision" ADD COLUMN     "greTRemitenteNumDoc" TEXT,
ADD COLUMN     "greTRemitenteRazonSocial" TEXT,
ALTER COLUMN "actualizadoEn" DROP DEFAULT;

-- AlterTable
ALTER TABLE "public"."ItemPedidoTienda" ALTER COLUMN "comboSnapshot" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "public"."Marca" ADD COLUMN     "imagenUrl" TEXT;

-- AlterTable
ALTER TABLE "public"."MovimientoCaja" ADD COLUMN     "categoriaGasto" TEXT,
ADD COLUMN     "descripcionGasto" TEXT,
ADD COLUMN     "metodoPago" TEXT,
ADD COLUMN     "monto" DECIMAL(65,30),
ADD COLUMN     "sedeId" INTEGER;

-- AlterTable
ALTER TABLE "public"."MovimientoKardex" ADD COLUMN     "compraId" INTEGER,
ADD COLUMN     "sedeId" INTEGER;

-- AlterTable
ALTER TABLE "public"."PedidoTienda" ADD COLUMN     "sedeId" INTEGER;

-- AlterTable
ALTER TABLE "public"."Plan" ADD COLUMN     "maxSedes" INTEGER DEFAULT 1;

-- AlterTable
ALTER TABLE "public"."PreferenciaTabla" ALTER COLUMN "visibleColumns" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "public"."Usuario" ADD COLUMN     "passwordResetExpires" TIMESTAMP(3),
ADD COLUMN     "passwordResetToken" TEXT,
ADD COLUMN     "resellerId" INTEGER,
ADD COLUMN     "sedeId" INTEGER;

-- AlterTable
ALTER TABLE "public"."WhatsAppEnvio" ALTER COLUMN "costoUSD" SET DATA TYPE DECIMAL(65,30);

-- AlterTable
ALTER TABLE "public"."combos" ALTER COLUMN "nombre" SET DATA TYPE TEXT,
ALTER COLUMN "imagenUrl" SET DATA TYPE TEXT,
ALTER COLUMN "precioRegular" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "precioCombo" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "descuentoPorcentaje" SET DATA TYPE DECIMAL(65,30);

-- AlterTable
ALTER TABLE "public"."grupos_modificadores" ALTER COLUMN "nombre" SET DATA TYPE TEXT,
ALTER COLUMN "descripcion" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "public"."opciones_modificadores" ALTER COLUMN "nombre" SET DATA TYPE TEXT,
ALTER COLUMN "descripcion" SET DATA TYPE TEXT,
ALTER COLUMN "precioExtra" SET DATA TYPE DECIMAL(65,30);

-- AlterTable
ALTER TABLE "public"."producto_plantillas" ALTER COLUMN "precioSugerido" SET DATA TYPE DECIMAL(65,30),
ALTER COLUMN "categoria" SET DATA TYPE TEXT,
ALTER COLUMN "marca" SET DATA TYPE TEXT;

-- CreateTable
CREATE TABLE "public"."Compra" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "proveedorId" INTEGER NOT NULL,
    "usuarioId" INTEGER,
    "tipoDoc" TEXT NOT NULL DEFAULT 'FACTURA',
    "serie" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "fechaVencimiento" TIMESTAMP(3),
    "moneda" TEXT NOT NULL DEFAULT 'PEN',
    "tipoCambio" DECIMAL(65,30) DEFAULT 1,
    "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "igv" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "saldo" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "estado" "public"."EstadoCompra" NOT NULL DEFAULT 'REGISTRADO',
    "estadoPago" "public"."EstadoPago" NOT NULL DEFAULT 'PENDIENTE_PAGO',
    "observaciones" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "cuotas" JSONB,
    "sedeId" INTEGER,

    CONSTRAINT "Compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DetalleCompra" (
    "id" SERIAL NOT NULL,
    "compraId" INTEGER NOT NULL,
    "productoId" INTEGER,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(65,30) NOT NULL,
    "precioUnitario" DECIMAL(65,30) NOT NULL,
    "subtotal" DECIMAL(65,30) NOT NULL,
    "igv" DECIMAL(65,30) NOT NULL,
    "total" DECIMAL(65,30) NOT NULL,
    "lote" TEXT,
    "fechaVencimiento" TIMESTAMP(3),

    CONSTRAINT "DetalleCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."EmpresaLog" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "accion" TEXT NOT NULL,
    "detalle" TEXT,
    "autorNombre" TEXT NOT NULL,
    "autorEmail" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmpresaLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."IngresoSistema" (
    "id" SERIAL NOT NULL,
    "concepto" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "monto" DECIMAL(65,30) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "descripcion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngresoSistema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MedioPagoDetraccion" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MedioPagoDetraccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."NotaEmpresa" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "contenido" TEXT NOT NULL,
    "autorNombre" TEXT NOT NULL,
    "autorEmail" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notificado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NotaEmpresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PagoCompra" (
    "id" SERIAL NOT NULL,
    "compraId" INTEGER NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "usuarioId" INTEGER,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "monto" DECIMAL(65,30) NOT NULL,
    "metodoPago" TEXT NOT NULL,
    "referencia" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagoCompra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PlanModulo" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "moduloId" INTEGER NOT NULL,

    CONSTRAINT "PlanModulo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProductoStock" (
    "id" SERIAL NOT NULL,
    "productoId" INTEGER NOT NULL,
    "sedeId" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "stockMinimo" INTEGER DEFAULT 0,
    "stockMaximo" INTEGER,
    "ubicacion" TEXT,

    CONSTRAINT "ProductoStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Reseller" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "representante" TEXT,
    "telefono" TEXT,
    "email" TEXT NOT NULL,
    "saldo" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "porcentajeDescuento" DECIMAL(5,2) NOT NULL DEFAULT 20.00,

    CONSTRAINT "Reseller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ResellerMovimiento" (
    "id" SERIAL NOT NULL,
    "resellerId" INTEGER NOT NULL,
    "empresaId" INTEGER,
    "tipo" TEXT NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "descripcion" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'APLICADO',
    "intento" INTEGER NOT NULL DEFAULT 1,
    "motivo" TEXT,

    CONSTRAINT "ResellerMovimiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ResellerRecarga" (
    "id" SERIAL NOT NULL,
    "resellerId" INTEGER NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "medioPago" TEXT,
    "referencia" TEXT,
    "observacion" TEXT,
    "usuarioId" INTEGER,

    CONSTRAINT "ResellerRecarga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Sede" (
    "id" SERIAL NOT NULL,
    "empresaId" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "codigo" TEXT,
    "esPrincipal" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sede_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TipoDetraccion" (
    "id" SERIAL NOT NULL,
    "codigo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "porcentaje" DECIMAL(65,30) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TipoDetraccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UsuarioSede" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "sedeId" INTEGER NOT NULL,

    CONSTRAINT "UsuarioSede_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."movimiento_kardex_lotes" (
    "id" SERIAL NOT NULL,
    "productoLoteId" INTEGER NOT NULL,
    "movimientoId" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "stockAnterior" INTEGER NOT NULL,
    "stockActual" INTEGER NOT NULL,

    CONSTRAINT "movimiento_kardex_lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."producto_lotes" (
    "id" SERIAL NOT NULL,
    "productoId" INTEGER NOT NULL,
    "lote" TEXT NOT NULL,
    "fechaVencimiento" TIMESTAMP(3) NOT NULL,
    "fechaIngreso" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stockActual" INTEGER NOT NULL DEFAULT 0,
    "stockInicial" INTEGER NOT NULL DEFAULT 0,
    "costoUnitario" DECIMAL(65,30),
    "proveedor" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "producto_lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."store_products" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "oldPrice" DECIMAL(10,2),
    "imageUrl" TEXT,
    "badge" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT,
    "stock" INTEGER,

    CONSTRAINT "store_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Compra_empresaId_idx" ON "public"."Compra"("empresaId" ASC);

-- CreateIndex
CREATE INDEX "Compra_fechaEmision_idx" ON "public"."Compra"("fechaEmision" ASC);

-- CreateIndex
CREATE INDEX "Compra_proveedorId_idx" ON "public"."Compra"("proveedorId" ASC);

-- CreateIndex
CREATE INDEX "DetalleCompra_compraId_idx" ON "public"."DetalleCompra"("compraId" ASC);

-- CreateIndex
CREATE INDEX "DetalleCompra_productoId_idx" ON "public"."DetalleCompra"("productoId" ASC);

-- CreateIndex
CREATE INDEX "EmpresaLog_creadoEn_idx" ON "public"."EmpresaLog"("creadoEn" ASC);

-- CreateIndex
CREATE INDEX "EmpresaLog_empresaId_idx" ON "public"."EmpresaLog"("empresaId" ASC);

-- CreateIndex
CREATE INDEX "IngresoSistema_fecha_idx" ON "public"."IngresoSistema"("fecha" ASC);

-- CreateIndex
CREATE INDEX "IngresoSistema_tipo_idx" ON "public"."IngresoSistema"("tipo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "MedioPagoDetraccion_codigo_key" ON "public"."MedioPagoDetraccion"("codigo" ASC);

-- CreateIndex
CREATE INDEX "NotaEmpresa_empresaId_idx" ON "public"."NotaEmpresa"("empresaId" ASC);

-- CreateIndex
CREATE INDEX "PagoCompra_compraId_idx" ON "public"."PagoCompra"("compraId" ASC);

-- CreateIndex
CREATE INDEX "PlanModulo_moduloId_idx" ON "public"."PlanModulo"("moduloId" ASC);

-- CreateIndex
CREATE INDEX "PlanModulo_planId_idx" ON "public"."PlanModulo"("planId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "PlanModulo_planId_moduloId_key" ON "public"."PlanModulo"("planId" ASC, "moduloId" ASC);

-- CreateIndex
CREATE INDEX "ProductoStock_productoId_idx" ON "public"."ProductoStock"("productoId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ProductoStock_productoId_sedeId_key" ON "public"."ProductoStock"("productoId" ASC, "sedeId" ASC);

-- CreateIndex
CREATE INDEX "ProductoStock_sedeId_idx" ON "public"."ProductoStock"("sedeId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Reseller_codigo_key" ON "public"."Reseller"("codigo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Reseller_email_key" ON "public"."Reseller"("email" ASC);

-- CreateIndex
CREATE INDEX "ResellerMovimiento_empresaId_tipo_fecha_idx" ON "public"."ResellerMovimiento"("empresaId" ASC, "tipo" ASC, "fecha" ASC);

-- CreateIndex
CREATE INDEX "ResellerMovimiento_resellerId_tipo_estado_idx" ON "public"."ResellerMovimiento"("resellerId" ASC, "tipo" ASC, "estado" ASC);

-- CreateIndex
CREATE INDEX "Sede_empresaId_idx" ON "public"."Sede"("empresaId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "TipoDetraccion_codigo_key" ON "public"."TipoDetraccion"("codigo" ASC);

-- CreateIndex
CREATE INDEX "UsuarioSede_sedeId_idx" ON "public"."UsuarioSede"("sedeId" ASC);

-- CreateIndex
CREATE INDEX "UsuarioSede_usuarioId_idx" ON "public"."UsuarioSede"("usuarioId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UsuarioSede_usuarioId_sedeId_key" ON "public"."UsuarioSede"("usuarioId" ASC, "sedeId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "movimiento_kardex_lotes_movimientoId_key" ON "public"."movimiento_kardex_lotes"("movimientoId" ASC);

-- CreateIndex
CREATE INDEX "movimiento_kardex_lotes_productoLoteId_idx" ON "public"."movimiento_kardex_lotes"("productoLoteId" ASC);

-- CreateIndex
CREATE INDEX "producto_lotes_productoId_activo_idx" ON "public"."producto_lotes"("productoId" ASC, "activo" ASC);

-- CreateIndex
CREATE INDEX "producto_lotes_productoId_fechaVencimiento_idx" ON "public"."producto_lotes"("productoId" ASC, "fechaVencimiento" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "producto_lotes_productoId_lote_key" ON "public"."producto_lotes"("productoId" ASC, "lote" ASC);

-- CreateIndex
CREATE INDEX "store_products_category_idx" ON "public"."store_products"("category" ASC);

-- CreateIndex
CREATE INDEX "store_products_isActive_order_idx" ON "public"."store_products"("isActive" ASC, "order" ASC);

-- CreateIndex
CREATE INDEX "Producto_empresaId_codigoBarras_idx" ON "public"."Producto"("empresaId" ASC, "codigoBarras" ASC);

-- AddForeignKey
ALTER TABLE "public"."Compra" ADD CONSTRAINT "Compra_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Compra" ADD CONSTRAINT "Compra_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "public"."Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Compra" ADD CONSTRAINT "Compra_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "public"."Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Compra" ADD CONSTRAINT "Compra_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "public"."Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Comprobante" ADD CONSTRAINT "Comprobante_medioPagoDetraccionId_fkey" FOREIGN KEY ("medioPagoDetraccionId") REFERENCES "public"."MedioPagoDetraccion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Comprobante" ADD CONSTRAINT "Comprobante_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "public"."Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Comprobante" ADD CONSTRAINT "Comprobante_tipoDetraccionId_fkey" FOREIGN KEY ("tipoDetraccionId") REFERENCES "public"."TipoDetraccion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DetalleCompra" ADD CONSTRAINT "DetalleCompra_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "public"."Compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DetalleCompra" ADD CONSTRAINT "DetalleCompra_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "public"."Producto"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Empresa" ADD CONSTRAINT "Empresa_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "public"."Reseller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."EmpresaLog" ADD CONSTRAINT "EmpresaLog_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."GuiaRemision" ADD CONSTRAINT "GuiaRemision_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "public"."Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "public"."Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MovimientoKardex" ADD CONSTRAINT "MovimientoKardex_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "public"."Compra"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MovimientoKardex" ADD CONSTRAINT "MovimientoKardex_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "public"."Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."NotaEmpresa" ADD CONSTRAINT "NotaEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PagoCompra" ADD CONSTRAINT "PagoCompra_compraId_fkey" FOREIGN KEY ("compraId") REFERENCES "public"."Compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PagoCompra" ADD CONSTRAINT "PagoCompra_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PagoCompra" ADD CONSTRAINT "PagoCompra_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "public"."Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PedidoTienda" ADD CONSTRAINT "PedidoTienda_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "public"."Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlanModulo" ADD CONSTRAINT "PlanModulo_moduloId_fkey" FOREIGN KEY ("moduloId") REFERENCES "public"."Modulo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PlanModulo" ADD CONSTRAINT "PlanModulo_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductoStock" ADD CONSTRAINT "ProductoStock_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "public"."Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProductoStock" ADD CONSTRAINT "ProductoStock_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "public"."Sede"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ResellerMovimiento" ADD CONSTRAINT "ResellerMovimiento_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ResellerMovimiento" ADD CONSTRAINT "ResellerMovimiento_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "public"."Reseller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ResellerRecarga" ADD CONSTRAINT "ResellerRecarga_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "public"."Reseller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Sede" ADD CONSTRAINT "Sede_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "public"."Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Usuario" ADD CONSTRAINT "Usuario_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "public"."Reseller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Usuario" ADD CONSTRAINT "Usuario_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "public"."Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UsuarioSede" ADD CONSTRAINT "UsuarioSede_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "public"."Sede"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UsuarioSede" ADD CONSTRAINT "UsuarioSede_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "public"."Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."movimiento_kardex_lotes" ADD CONSTRAINT "movimiento_kardex_lotes_movimientoId_fkey" FOREIGN KEY ("movimientoId") REFERENCES "public"."MovimientoKardex"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."movimiento_kardex_lotes" ADD CONSTRAINT "movimiento_kardex_lotes_productoLoteId_fkey" FOREIGN KEY ("productoLoteId") REFERENCES "public"."producto_lotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."producto_lotes" ADD CONSTRAINT "producto_lotes_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "public"."Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
