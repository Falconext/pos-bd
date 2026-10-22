/**
 * Reporte diario por WhatsApp al dueño (2026-10-21): a las 9 p. m., desde el
 * número de Krezka, solo a quien tiene IA de Ventas y lo activó.
 */
import { armarReporte, comparacionConAyer, diaLegible, paraParametro, type DatosReporte } from './reporte-diario';
import { ReporteDiarioService, celularParaWhatsapp, fechaLima } from './reporte-diario.service';

const DATOS: DatosReporte = {
  negocio: 'Hierba Sana',
  fecha: '2026-10-21',
  vendido: 1240.5,
  ventas: 18,
  vendidoAyer: 980,
  top: [
    { descripcion: 'Moringa 90 cápsulas', cantidad: 12 },
    { descripcion: 'Uña de gato', cantidad: 5 },
  ],
  chat: { conversacionesNuevas: 34, pedidos: 5, vendidoPorChat: 610, esperandoPersona: 2 },
  porDespachar: 7,
};

describe('el mensaje', () => {
  it('dice cuánto vendió, contra ayer, lo más vendido, el chat y lo pendiente', () => {
    const { texto } = armarReporte(DATOS);
    expect(texto).toContain('*Resumen de hoy, miércoles 21/10*');
    expect(texto).toContain('Vendiste *S/ 1,240.50* en 18 ventas');
    expect(texto).toContain('+27% vs. ayer (S/ 980.00)');
    expect(texto).toContain('Moringa 90 cápsulas (12), Uña de gato (5)');
    expect(texto).toContain('34 personas nuevas por WhatsApp; 5 compraron por el chat (S/ 610.00)');
    expect(texto).toContain('2 chats esperan que alguien del equipo responda');
    expect(texto).toContain('7 pedidos por despachar');
  });

  it('un día sin ventas ni pendientes no inventa líneas', () => {
    const { texto } = armarReporte({
      ...DATOS,
      vendido: 0,
      ventas: 0,
      vendidoAyer: 0,
      top: [],
      chat: { conversacionesNuevas: 1, pedidos: 0, vendidoPorChat: 0, esperandoPersona: 0 },
      porDespachar: 0,
    });
    expect(texto).toContain('Hoy no se registraron ventas');
    expect(texto).toContain('1 persona nueva por WhatsApp');
    const sinNadie = armarReporte({ ...DATOS, chat: { conversacionesNuevas: 0, pedidos: 0, vendidoPorChat: 0, esperandoPersona: 0 } });
    expect(sinNadie.texto).toContain('Hoy nadie nuevo te escribió por WhatsApp');
    expect(sinNadie.parametros[3]).not.toContain('0 personas');
    const largo = armarReporte({ ...DATOS, top: [{ descripcion: 'X'.repeat(80), cantidad: 1 }] });
    expect(largo.texto).toContain(`${'X'.repeat(39)}… (1)`);
    expect(texto).not.toMatch(/vs\. ayer|Lo que más salió|esperan|despachar|compró/);
  });

  it('la plantilla lleva lo mismo en 4 parámetros, sin saltos de línea ni vacíos', () => {
    const { parametros } = armarReporte(DATOS);
    expect(parametros.slice(0, 3)).toEqual(['Hierba Sana', 'S/ 1,240.50', '18']);
    expect(parametros[3]).toContain('subiste 27% vs. ayer');
    expect(parametros[3]).toContain('7 por despachar');
    for (const p of parametros) expect(p).not.toMatch(/\n|\t| {2,}/);
    expect(paraParametro('  \n ')).toBe('—');
  });

  it('comparación: bajada, igual, y sin ventas ayer no hay porcentaje', () => {
    expect(comparacionConAyer(50, 100)).toBe('-50% vs. ayer (S/ 100.00)');
    expect(comparacionConAyer(100, 100)).toBe('igual que ayer (S/ 100.00)');
    expect(comparacionConAyer(100, 0)).toBeNull();
    expect(diaLegible('2026-10-25')).toBe('domingo 25/10');
  });
});

describe('a quién', () => {
  it('solo celulares peruanos, en el formato de WhatsApp', () => {
    expect(celularParaWhatsapp('991 065 217')).toBe('51991065217');
    expect(celularParaWhatsapp('+51 991065217')).toBe('51991065217');
    expect(celularParaWhatsapp('014567890')).toBeNull();
    expect(celularParaWhatsapp('999000001x')).toBe('51999000001');
    expect(celularParaWhatsapp('')).toBeNull();
  });

  it('la fecha es la de Lima, no la del servidor', () => {
    // 02:00 UTC del 22 = 21:00 del 21 en Lima.
    expect(fechaLima(new Date('2026-10-22T02:00:00Z'))).toBe('2026-10-21');
    expect(fechaLima(new Date('2026-10-22T02:00:00Z'), 1)).toBe('2026-10-20');
  });
});

describe('el envío', () => {
  function armar(opts: { textoOk?: boolean; plantillaOk?: boolean; config?: any; admins?: any[] } = {}) {
    let json: any = { reporteDiario: opts.config ?? { activo: true } };
    const prisma: any = {
      empresa: {
        findUnique: jest.fn(async () => ({ iaVentasConfigJson: json, nombreComercial: 'Hierba Sana' })),
        findMany: jest.fn(async () => [{ id: 89, iaVentasConfigJson: json }]),
        update: jest.fn(async ({ data }: any) => {
          json = data.iaVentasConfigJson;
        }),
      },
      usuario: {
        findMany: jest.fn(async () =>
          opts.admins ?? [
            { nombre: 'Dueña', celular: '991 065 217' },
            { nombre: 'Socio', celular: '+51991065217' },
            { nombre: 'Sin celular', celular: '' },
          ],
        ),
      },
      leadConversacion: { count: jest.fn(async () => 3), findMany: jest.fn(async () => [{ id: 1 }, { id: 2 }]) },
      leadPedidoBorrador: { findMany: jest.fn(async () => [{ comprobanteId: 10 }, { comprobanteId: 11 }]) },
      comprobante: {
        findMany: jest.fn(async () => [
          { mtoImpVenta: 100, estadoPago: 'COMPLETADO', estadoEnvioSunat: 'EMITIDO' },
          { mtoImpVenta: 999, estadoPago: 'ANULADO', estadoEnvioSunat: 'EMITIDO' },
        ]),
      },
      leadMensaje: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ rol: 'USUARIO' })
          .mockResolvedValueOnce({ rol: 'ASISTENTE' }),
      },
      envioDespacho: { count: jest.fn(async () => 4) },
    };
    const whatsapp: any = {
      enviarTexto: jest.fn(async () =>
        opts.textoOk ? { success: true } : { success: false, error: 'fuera de la ventana de 24 h' },
      ),
      enviarPlantilla: jest.fn(async () =>
        opts.plantillaOk === false ? { success: false, error: 'plantilla en revisión' } : { success: true },
      ),
      crearPlantillaResumenDia: jest.fn(async () => ({ creadas: ['resumen_del_dia'] })),
    };
    const dashboard: any = {
      headerResumen: jest
        .fn()
        .mockResolvedValueOnce({ totalIngresos: 300 })
        .mockResolvedValueOnce({ totalIngresos: 200 }),
      cantidadVentas: jest.fn(async () => 4),
      topProductos: jest.fn(async () => [{ producto: { descripcion: 'Moringa' }, cantidad: 3 }]),
    };
    return { s: new ReporteDiarioService(prisma, whatsapp, dashboard), prisma, whatsapp, dashboard, json: () => json };
  }

  it('los números: ventas del panel, pedidos del chat sin anulados, chats que esperan a una persona', async () => {
    const { s } = armar();
    const d = await s.datos(89, '2026-10-21');
    expect(d).toMatchObject({
      negocio: 'Hierba Sana',
      vendido: 300,
      vendidoAyer: 200,
      ventas: 4,
      top: [{ descripcion: 'Moringa', cantidad: 3 }],
      chat: { conversacionesNuevas: 3, pedidos: 1, vendidoPorChat: 100, esperandoPersona: 1 },
      porDespachar: 4,
    });
  });

  it('sale del número de Krezka, una vez por celular, con plantilla si la ventana está cerrada', async () => {
    const { s, whatsapp } = armar();
    const r = await s.enviar(89, '2026-10-21');
    expect(r).toEqual({ enviados: 1, fallidos: 0 });
    expect(whatsapp.enviarTexto).toHaveBeenCalledWith('51991065217', expect.any(String), 22);
    expect(whatsapp.enviarPlantilla).toHaveBeenCalledWith(
      '51991065217',
      'resumen_del_dia',
      'es',
      expect.arrayContaining(['Hierba Sana']),
      22,
    );
  });

  it('con la ventana abierta va el texto y no se paga la plantilla', async () => {
    const { s, whatsapp } = armar({ textoOk: true });
    await s.enviar(89, '2026-10-21');
    expect(whatsapp.enviarPlantilla).not.toHaveBeenCalled();
  });

  it('a las 9 p. m. marca el día antes de mandar y no lo repite', async () => {
    const { s, whatsapp, json } = armar();
    await s.enviarATodos();
    expect(json().reporteDiario.ultimoEnvio).toBe(fechaLima());
    expect(whatsapp.enviarTexto).toHaveBeenCalledTimes(1);
    await s.enviarATodos();
    expect(whatsapp.enviarTexto).toHaveBeenCalledTimes(1);
  });

  it('solo empresas con IA de Ventas, y solo si lo activaron', async () => {
    const { s, prisma, whatsapp } = armar({ config: { activo: false } });
    await s.enviarATodos();
    expect(prisma.empresa.findMany.mock.calls[0][0].where.plan).toEqual({
      modulosAsignados: { some: { modulo: { codigo: 'leads' } } },
    });
    expect(whatsapp.enviarTexto).not.toHaveBeenCalled();
  });

  it('activarlo sin un celular válido explica qué falta; al activar se pide la plantilla en Krezka', async () => {
    const sin = armar({ admins: [{ nombre: 'X', celular: '014567890' }] });
    await expect(sin.s.activar(89, true)).rejects.toThrow('celular válido');
    const con = armar({ config: {} });
    const r = await con.s.activar(89, true);
    expect(r.activo).toBe(true);
    expect(r.destinatarios).toEqual([{ nombre: 'Dueña', numero: '991 065 217' }]);
    expect(con.whatsapp.crearPlantillaResumenDia).toHaveBeenCalledWith(22);
  });

  it('"mándame uno ahora" dice por qué no salió', async () => {
    const { s } = armar({ plantillaOk: false });
    await expect(s.probar(89)).rejects.toThrow('WhatsApp no aceptó el mensaje (plantilla en revisión)');
  });
});
