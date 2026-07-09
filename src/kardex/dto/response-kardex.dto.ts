export interface MovimientoKardexResponse {
  id: number;
  fecha: Date;
  tipoMovimiento: string;
  concepto: string;
  cantidad: number;
  stockAnterior: number;
  stockActual: number;
  costoUnitario?: number;
  valorTotal?: number;
  gananciaUnidad?: number;
  observacion?: string;
  lote?: string;
  fechaVencimiento?: Date;
  usuario?: {
    id: number;
    nombre: string;
  };
  comprobante?: {
    id: number;
    tipoDoc: string;
    serie: string;
    correlativo: number;
  };
  producto: {
    id: number;
    codigo: string;
    descripcion: string;
    unidadMedida: {
      codigo: string;
      nombre: string;
    };
  };
}

export interface KardexProductoResponse {
  producto: {
    id: number;
    codigo: string;
    descripcion: string;
    stock: number;
    stockMinimo: number;
    stockMaximo: number;
    costoPromedio: number;
    unidadMedida: {
      codigo: string;
      nombre: string;
    };
    categoria?: {
      id: number;
      nombre: string;
    };
  };
  movimientos: MovimientoKardexResponse[];
  resumen: {
    totalIngresos: number;
    totalSalidas: number;
    totalAjustes: number;
    stockActual: number;
    valorInventario: number;
  };
  paginacion: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface InventarioValorizadoResponse {
  productos: Array<{
    id: number;
    codigo: string;
    descripcion: string;
    stock: number;
    costoPromedio: number;
    valorTotal: number;
    stockMinimo: number;
    stockMaximo: number;
    categoria?: {
      id: number;
      nombre: string;
    };
    unidadMedida: {
      codigo: string;
      nombre: string;
    };
    ultimoMovimiento?: {
      fecha: Date;
      tipoMovimiento: string;
      concepto: string;
    };
  }>;
  resumen: {
    totalProductos: number;
    valorTotalInventario: number;
    productosStockCritico: number;
    productosStockCero: number;
  };
}

export interface ReporteRotacionResponse {
  productos: Array<{
    id: number;
    codigo: string;
    descripcion: string;
    categoria?: string;
    ventasUltimosPeriodos: {
      periodo1: number; // último mes
      periodo2: number; // mes anterior
      periodo3: number; // 3 meses atrás
    };
    stockPromedio: number;
    rotacion: number; // veces que rota al año
    diasInventario: number; // días que dura el inventario
    clasificacion: 'ALTO' | 'MEDIO' | 'BAJO' | 'NULO';
  }>;
  resumenGeneral: {
    rotacionPromedio: number;
    diasInventarioPromedio: number;
    productosAltaRotacion: number;
    productosMediaRotacion: number;
    productosBajaRotacion: number;
  };
}
