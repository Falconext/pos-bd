import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import {
  DETALLE_ADICIONAL_MAX,
  lineasDetalleAdicional,
  normalizarDetalleAdicional,
} from './detalle-adicional';
import { ComprobanteService } from './comprobante.service';

describe('detalle adicional de la línea (cotización de servicios)', () => {
  const ejemplo =
    'Retiro de pintura antigua\r\nRaspado, lijado y eliminación de material suelto\nlimpieza';

  it('conserva los saltos de línea y el texto tal cual (sin pasarlo a mayúsculas)', () => {
    expect(normalizarDetalleAdicional(ejemplo)).toBe(
      'Retiro de pintura antigua\nRaspado, lijado y eliminación de material suelto\nlimpieza',
    );
  });

  it('vacío, null o solo espacios → null (no guarda "")', () => {
    expect(normalizarDetalleAdicional(undefined)).toBeNull();
    expect(normalizarDetalleAdicional(null)).toBeNull();
    expect(normalizarDetalleAdicional('')).toBeNull();
    expect(normalizarDetalleAdicional('  \n \n ')).toBeNull();
  });

  it('quita líneas vacías al inicio/fin y espacios sobrantes al final de cada línea', () => {
    expect(normalizarDetalleAdicional('\n\n  uno   \ndos  \n\n')).toBe(
      'uno\ndos',
    );
  });

  it('recorta al tope de caracteres', () => {
    const largo = 'x'.repeat(DETALLE_ADICIONAL_MAX + 50);
    expect(normalizarDetalleAdicional(largo)!.length).toBe(
      DETALLE_ADICIONAL_MAX,
    );
  });

  it('lineasDetalleAdicional devuelve una entrada por línea no vacía', () => {
    expect(lineasDetalleAdicional('a\n\n b \nc')).toEqual(['a', 'b', 'c']);
    expect(lineasDetalleAdicional(null)).toEqual([]);
  });

  it('la plantilla de cotización imprime el detalle debajo del título, escapado', () => {
    const src = fs.readFileSync(
      path.join(__dirname, 'templates', 'cotizacion.hbs'),
      'utf-8',
    );
    // Mismos helpers que registra PdfGeneratorService (versión mínima).
    const hb = Handlebars.create();
    hb.registerHelper('includes', () => false);
    hb.registerHelper('inc', (v: number) => v + 1);
    hb.registerHelper('eq', (a: any, b: any) => a === b);
    hb.registerHelper('or', (...a: any[]) => a.slice(0, -1).some(Boolean));
    hb.registerHelper('vis', () => true);
    hb.registerHelper('pos', (v: any) => Number(v) > 0);
    hb.registerHelper('fsz', (_fc: any, _k: string, d: any) => Number(d) || 12);
    hb.registerHelper('tpx', () => 12);
    const tpl = hb.compile(src);
    const html = tpl({
      fc: {},
      productos: [
        {
          codigo: '',
          cantidad: '1',
          unidadMedida: 'ZZ',
          descripcion: 'RETIRO DE PINTURA DE PARED PISO 6',
          detalleLineas: lineasDetalleAdicional(
            ejemplo + '\n<script>alert(1)</script>',
          ),
          precioUnitario: '100.00',
          total: '100.00',
        },
      ],
    });
    const iTitulo = html.indexOf('RETIRO DE PINTURA DE PARED PISO 6');
    const iDetalle = html.indexOf('Retiro de pintura antigua');
    expect(iTitulo).toBeGreaterThan(-1);
    expect(iDetalle).toBeGreaterThan(iTitulo);
    expect(html).toContain('Raspado, lijado y eliminación de material suelto');
    expect(html).toContain('>limpieza<');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('el armado del XML UBL de SUNAT no lee el detalle (solo `descripcion`)', () => {
    // Guardia de diseño: el detalle multilínea es solo para el PDF. Si alguien
    // lo mete al cbc:Description, una factura convertida desde la cotización
    // viajaría con saltos de línea a SUNAT.
    for (const f of [
      path.join(__dirname, 'enviar-sunat.service.ts'),
      path.join(__dirname, '..', 'common', 'utils', 'ubl-xml.ts'),
      path.join(__dirname, '..', 'common', 'utils', 'jamble.client.ts'),
    ]) {
      expect(fs.readFileSync(f, 'utf-8')).not.toContain('detalleAdicional');
    }
  });

  it('cargarProductosYDetalles lo persiste en ítem libre y en producto, sin tocar la descripción', async () => {
    const prisma = {
      producto: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 7,
            descripcion: 'PINTURA LATEX',
            precioUnitario: 50,
            tipoAfectacionIGV: '10',
            igvPorcentaje: 18,
            unidadMedida: { codigo: 'NIU' },
            estado: 'ACTIVO',
            empresaId: 1,
          },
        ]),
      },
    };
    const deps = Array(7).fill({}) as [any, any, any, any, any, any, any];
    const svc = new ComprobanteService(prisma as any, ...deps) as any;
    const { detalleFinal } = await svc.cargarProductosYDetalles(
      [
        {
          productoId: null,
          descripcion: 'RETIRO DE PINTURA DE PARED PISO 6',
          detalleAdicional: ejemplo,
          cantidad: 1,
          nuevoValorUnitario: 850,
          unidadVenta: 'ZZ',
        },
        {
          productoId: 7,
          cantidad: 2,
          nuevoValorUnitario: 50,
          detalleAdicional: 'Color blanco humo',
        },
        {
          productoId: null,
          descripcion: 'SIN DETALLE',
          cantidad: 1,
          nuevoValorUnitario: 10,
          detalleAdicional: '  ',
        },
      ],
      1,
    );
    expect(detalleFinal[0].descripcion).toBe(
      'RETIRO DE PINTURA DE PARED PISO 6',
    );
    expect(detalleFinal[0].detalleAdicional).toBe(
      'Retiro de pintura antigua\nRaspado, lijado y eliminación de material suelto\nlimpieza',
    );
    expect(detalleFinal[1].detalleAdicional).toBe('Color blanco humo');
    expect(detalleFinal[1].descripcion).toBe('PINTURA LATEX');
    expect(detalleFinal[2]).not.toHaveProperty('detalleAdicional');
  });
});
