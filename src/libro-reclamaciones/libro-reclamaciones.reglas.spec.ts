import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import {
  HojaEntrada,
  aReclamo,
  direccionCompleta,
  estadoDerivado,
  formatearCodigo,
  generarTokenConstancia,
  hashToken,
  validarHoja,
  validarRespuesta,
  verificarTokenConstancia,
} from './libro-reclamaciones.reglas';
import { excelLibro, htmlConstancia } from './libro-reclamaciones.documentos';
import { filaBase, hojaValida } from './libro-reclamaciones.fixtures';

/** Mensajes del 400 (validarHoja junta todos los errores). */
function errores(entrada: HojaEntrada): string[] {
  try {
    validarHoja(entrada);
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    const r = (e as BadRequestException).getResponse() as {
      message: string | string[];
    };
    return Array.isArray(r.message) ? r.message : [r.message];
  }
  throw new Error('Se esperaba un 400');
}

describe('validarHoja', () => {
  it('acepta una hoja válida y la normaliza', () => {
    const h = validarHoja(hojaValida());
    expect(h.nombres).toBe('Ana Pérez');
    expect(h.email).toBe('ana@correo.pe');
    expect(h.montoReclamado).toBe(150.5);
    expect(h.apoderadoNombre).toBeNull();
    expect(h.aceptaDeclaracion).toBe(true);
  });

  it('DNI con 7 dígitos → 400', () => {
    expect(errores(hojaValida({ numeroDocumento: '1234567' }))).toContain(
      'El DNI debe tener 8 dígitos.',
    );
  });

  it('DNI con letras → 400', () => {
    expect(errores(hojaValida({ numeroDocumento: '1234567A' }))).toContain(
      'El DNI debe tener 8 dígitos.',
    );
  });

  it('RUC con 11 dígitos pasa; con 10 no', () => {
    expect(
      validarHoja(
        hojaValida({ tipoDocumento: 'RUC', numeroDocumento: '20123456789' }),
      ).numeroDocumento,
    ).toBe('20123456789');
    expect(
      errores(
        hojaValida({ tipoDocumento: 'RUC', numeroDocumento: '2012345678' }),
      ),
    ).toContain('El RUC debe tener 11 dígitos.');
  });

  it('CE y pasaporte alfanuméricos (se pasan a mayúsculas)', () => {
    expect(
      validarHoja(
        hojaValida({ tipoDocumento: 'CE', numeroDocumento: 'ab123456' }),
      ).numeroDocumento,
    ).toBe('AB123456');
    expect(
      validarHoja(
        hojaValida({ tipoDocumento: 'PASAPORTE', numeroDocumento: 'X1234567' }),
      ).numeroDocumento,
    ).toBe('X1234567');
  });

  it('tipo de documento desconocido → 400', () => {
    expect(errores(hojaValida({ tipoDocumento: 'LIBRETA' }))).toContain(
      'El tipo de documento no es válido.',
    );
  });

  it('menor de edad sin apoderado → 400 (nombre y documento)', () => {
    const e = errores(hojaValida({ menorDeEdad: true }));
    expect(e.some((m) => m.includes('nombre de tu padre'))).toBe(true);
    expect(e.some((m) => m.includes('documento de tu padre'))).toBe(true);
  });

  it('menor de edad con apoderado → OK', () => {
    const h = validarHoja(
      hojaValida({
        menorDeEdad: true,
        apoderadoNombre: 'Luis Pérez',
        apoderadoDocumento: '87654321',
      }),
    );
    expect(h.menorDeEdad).toBe(true);
    expect(h.apoderadoDocumento).toBe('87654321');
  });

  it('apoderado se ignora si no es menor', () => {
    const h = validarHoja(
      hojaValida({ apoderadoNombre: 'X', apoderadoDocumento: '1' }),
    );
    expect(h.apoderadoNombre).toBeNull();
  });

  it('honeypot con contenido → 400 sin detalles', () => {
    expect(errores(hojaValida({ website: 'http://spam' }))).toEqual([
      'Solicitud inválida.',
    ]);
  });

  it('sin aceptar la declaración → 400 (también con "true" en texto)', () => {
    expect(errores(hojaValida({ aceptaDeclaracion: false })).join()).toContain(
      'aceptar la declaración',
    );
    expect(errores(hojaValida({ aceptaDeclaracion: 'true' })).join()).toContain(
      'aceptar la declaración',
    );
  });

  it('correo inválido → 400', () => {
    expect(errores(hojaValida({ email: 'ana@correo' }))).toContain(
      'El correo no es válido.',
    );
  });

  it('detalle de menos de 10 o más de 3000 caracteres → 400', () => {
    expect(errores(hojaValida({ detalle: 'corto' })).join()).toContain(
      'El detalle',
    );
    expect(errores(hojaValida({ detalle: 'x'.repeat(3001) })).join()).toContain(
      'El detalle',
    );
    expect(
      validarHoja(hojaValida({ detalle: 'x'.repeat(3000) })).detalle,
    ).toHaveLength(3000);
  });

  it('pedido del consumidor de menos de 5 caracteres → 400', () => {
    expect(errores(hojaValida({ pedidoConsumidor: 'no' })).join()).toContain(
      'Lo que solicitas',
    );
  });

  it('monto: negativo y 3 decimales → 400; vacío → null; 0 → 0', () => {
    expect(errores(hojaValida({ montoReclamado: -1 }))).toContain(
      'El monto reclamado no es válido.',
    );
    expect(errores(hojaValida({ montoReclamado: '10.005' }))).toContain(
      'El monto reclamado admite como máximo 2 decimales.',
    );
    expect(errores(hojaValida({ montoReclamado: 'abc' }))).toContain(
      'El monto reclamado no es válido.',
    );
    expect(
      validarHoja(hojaValida({ montoReclamado: '' })).montoReclamado,
    ).toBeNull();
    expect(validarHoja(hojaValida({ montoReclamado: 0 })).montoReclamado).toBe(
      0,
    );
    expect(
      validarHoja(hojaValida({ montoReclamado: 19.99 })).montoReclamado,
    ).toBe(19.99);
  });

  it('tipo inválido y campos vacíos se reportan juntos', () => {
    const e = errores({ website: '' });
    expect(e.length).toBeGreaterThan(8);
    expect(e).toContain('Indica si es un reclamo o una queja.');
  });

  it('campos que no son texto no revientan (objetos, números)', () => {
    expect(errores(hojaValida({ nombres: { $ne: '' } as unknown }))).toContain(
      'El nombre es obligatorio.',
    );
  });
});

describe('validarRespuesta', () => {
  it('10–4000 caracteres', () => {
    expect(() => validarRespuesta('corta')).toThrow(BadRequestException);
    expect(() => validarRespuesta('x'.repeat(4001))).toThrow(
      BadRequestException,
    );
    expect(validarRespuesta('  Le cambiamos el producto.  ')).toBe(
      'Le cambiamos el producto.',
    );
  });
});

describe('código, token y estado', () => {
  it('formato AAAA-NNNNNN', () => {
    expect(formatearCodigo(2026, 1)).toBe('2026-000001');
    expect(formatearCodigo(2026, 123456)).toBe('2026-123456');
    expect(() => formatearCodigo(2026, 0)).toThrow(RangeError);
    expect(() => formatearCodigo(2026, 1_000_000)).toThrow(RangeError);
  });

  it('token: el correcto abre, otro no, vacío/no-texto no', () => {
    const token = generarTokenConstancia();
    const hash = hashToken(token);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(hash).not.toContain(token);
    expect(verificarTokenConstancia(token, hash)).toBe(true);
    expect(verificarTokenConstancia(generarTokenConstancia(), hash)).toBe(
      false,
    );
    expect(verificarTokenConstancia('', hash)).toBe(false);
    expect(verificarTokenConstancia(undefined, hash)).toBe(false);
    expect(verificarTokenConstancia(['x'], hash)).toBe(false);
    expect(verificarTokenConstancia(token, '')).toBe(false);
  });

  it('VENCIDO es derivado', () => {
    const limite = new Date('2026-04-23T04:59:59.999Z');
    expect(
      estadoDerivado('PENDIENTE', limite, new Date('2026-04-22T20:00:00Z')),
    ).toBe('PENDIENTE');
    expect(
      estadoDerivado('PENDIENTE', limite, new Date('2026-04-23T05:00:00Z')),
    ).toBe('VENCIDO');
    expect(estadoDerivado('RESPONDIDO', limite, new Date('2027-01-01'))).toBe(
      'RESPONDIDO',
    );
  });

  it('dirección completa sin repetir el distrito', () => {
    expect(
      direccionCompleta({
        direccion: 'Jr. Lima 1',
        distrito: 'Miraflores',
        provincia: 'Lima',
        departamento: 'Lima',
      }),
    ).toBe('Jr. Lima 1 - Miraflores');
    expect(
      direccionCompleta({
        direccion: 'Av. Sol 2',
        distrito: 'Cusco',
        provincia: null,
      }),
    ).toBe('Av. Sol 2 - Cusco');
  });
});

describe('aReclamo y documentos', () => {
  it('mapea al contrato: tipo, proveedor, monto numérico, días restantes; sin hash', () => {
    const r = aReclamo(filaBase, new Date('2026-04-20T13:00:00Z'));
    expect(r.tipo).toBe('RECLAMO');
    expect(r.estado).toBe('PENDIENTE');
    expect(r.montoReclamado).toBe(150.5);
    expect(r.diasHabilesRestantes).toBe(2);
    expect(r.proveedor.ruc).toBe('20123456789');
    expect(r).not.toHaveProperty('tokenHash');
    expect(r).not.toHaveProperty('ip');
  });

  it('respondido → diasHabilesRestantes null', () => {
    const r = aReclamo({
      ...filaBase,
      estado: 'RESPONDIDO',
      respuesta: 'ok',
      respondidoPor: { id: 3, nombre: 'Dueño' },
    });
    expect(r.diasHabilesRestantes).toBeNull();
    expect(r.respondidoPor).toEqual({ id: 3, nombre: 'Dueño' });
  });

  it('la constancia escapa el HTML del consumidor y marca el tipo', () => {
    const html = htmlConstancia(aReclamo(filaBase), 'javascript:alert(1)');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('segunda línea');
    expect(html).toContain('2026-000001');
    expect(html).toContain('&#9746; Reclamo');
    expect(html).not.toContain('javascript:');
  });

  it('el Excel neutraliza fórmulas del consumidor', () => {
    const buf = excelLibro([aReclamo(filaBase)]);
    const hoja = XLSX.read(buf, { type: 'buffer' }).Sheets[
      'Libro de reclamaciones'
    ];
    const filas = XLSX.utils.sheet_to_json<Record<string, string>>(hoja);
    expect(filas).toHaveLength(1);
    expect(filas[0]['Código']).toBe('2026-000001');
    expect(filas[0]['Descripción del bien'].startsWith("'=")).toBe(true);
    expect(Object.values(hoja).some((c: any) => c && c.f)).toBe(false);
  });
});
