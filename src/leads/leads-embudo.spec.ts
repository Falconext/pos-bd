/**
 * E1 — las reglas del embudo y, sobre todo, el candado de pago.
 *
 * El anexo de Hierba Sana lo pone así: *"Ningún pedido pasa a POR_DESPACHAR
 * sin la validación y clic manual del encargado"*. Si eso se puede saltar, el
 * negocio despacha mercadería contra un pago que nadie miró.
 */
import {
  EtapaCrm,
  ORDEN_EMBUDO,
  DESVIOS,
  esAvance,
  etapaDesdeDespacho,
  puedeMover,
  ETIQUETA_ETAPA,
} from './leads-embudo';

describe('las 12 etapas del anexo', () => {
  it('son exactamente 12, con los nombres que puso el cliente', () => {
    const todas = Object.values(EtapaCrm);
    expect(todas).toHaveLength(12);
    expect(todas).toEqual([
      'NUEVO',
      'DIAGNOSTICADO',
      'COTIZADO',
      'DATOS_COMPLETOS',
      'PENDIENTE_VALIDACION_PAGO',
      'POR_DESPACHAR',
      'EN_RUTA',
      'ENTREGADO',
      'REPROGRAMADO',
      'FRIO',
      'NO_CONTESTA',
      'CONSULTADO_NO_HABIDO',
    ]);
  });

  it('todas tienen nombre legible para el panel', () => {
    for (const e of Object.values(EtapaCrm)) {
      expect(ETIQUETA_ETAPA[e]).toBeTruthy();
    }
  });

  it('el recorrido feliz y los desvíos cubren las 12 sin repetir', () => {
    expect([...ORDEN_EMBUDO, ...DESVIOS].sort()).toEqual(
      Object.values(EtapaCrm).sort(),
    );
  });
});

describe('el candado de pago', () => {
  it('el bot NO puede pasar un pedido a despacho', () => {
    const v = puedeMover(
      EtapaCrm.PENDIENTE_VALIDACION_PAGO,
      EtapaCrm.POR_DESPACHAR,
      'bot',
    );
    expect(v.permitido).toBe(false);
    expect(v.motivo).toMatch(/solo una persona/i);
  });

  it('desde NINGUNA etapa el bot lo logra', () => {
    for (const desde of Object.values(EtapaCrm)) {
      if (desde === EtapaCrm.POR_DESPACHAR) continue;
      expect(
        puedeMover(desde, EtapaCrm.POR_DESPACHAR, 'bot').permitido,
      ).toBe(false);
    }
  });

  it('una persona sí, con el pago validado', () => {
    expect(
      puedeMover(
        EtapaCrm.PENDIENTE_VALIDACION_PAGO,
        EtapaCrm.POR_DESPACHAR,
        'humano',
      ).permitido,
    ).toBe(true);
  });

  it('una persona también desde datos completos: en Lima es contraentrega', () => {
    // No hay voucher que validar, pero el clic sigue siendo de una persona.
    expect(
      puedeMover(EtapaCrm.DATOS_COMPLETOS, EtapaCrm.POR_DESPACHAR, 'humano')
        .permitido,
    ).toBe(true);
  });

  it('pero no se puede despachar un pedido sin datos de entrega', () => {
    const v = puedeMover(EtapaCrm.COTIZADO, EtapaCrm.POR_DESPACHAR, 'humano');
    expect(v.permitido).toBe(false);
    expect(v.motivo).toMatch(/datos de entrega/i);
  });

  it('un pedido reprogramado vuelve a despacho: la entrega se reintenta', () => {
    expect(
      puedeMover(EtapaCrm.REPROGRAMADO, EtapaCrm.POR_DESPACHAR, 'humano')
        .permitido,
    ).toBe(true);
  });
});

describe('reprogramar', () => {
  it('lo decide una persona, no el sistema', () => {
    expect(
      puedeMover(EtapaCrm.EN_RUTA, EtapaCrm.REPROGRAMADO, 'bot').permitido,
    ).toBe(false);
    expect(
      puedeMover(EtapaCrm.EN_RUTA, EtapaCrm.REPROGRAMADO, 'humano').permitido,
    ).toBe(true);
  });
});

describe('los desvíos se pueden registrar casi siempre', () => {
  it('el bot puede marcar frío, no contesta y consultó algo que no hay', () => {
    for (const hacia of [
      EtapaCrm.FRIO,
      EtapaCrm.NO_CONTESTA,
      EtapaCrm.CONSULTADO_NO_HABIDO,
    ]) {
      expect(puedeMover(EtapaCrm.COTIZADO, hacia, 'bot').permitido).toBe(true);
    }
  });

  it('el cliente que paga antes de dar la dirección no rompe nada', () => {
    // En la calle las cosas pasan en desorden. Un embudo que no deja
    // registrar lo que de verdad pasó termina ignorado y lleno de datos falsos.
    expect(
      puedeMover(
        EtapaCrm.COTIZADO,
        EtapaCrm.PENDIENTE_VALIDACION_PAGO,
        'bot',
      ).permitido,
    ).toBe(true);
  });
});

describe('un pedido ya entregado', () => {
  it('no vuelve a cotizado: eso es un error de tipeo', () => {
    const v = puedeMover(EtapaCrm.ENTREGADO, EtapaCrm.COTIZADO, 'humano');
    expect(v.permitido).toBe(false);
    expect(v.motivo).toMatch(/ya está entregado/i);
  });

  it('pero sí puede reprogramarse por una devolución', () => {
    expect(
      puedeMover(EtapaCrm.ENTREGADO, EtapaCrm.REPROGRAMADO, 'humano').permitido,
    ).toBe(true);
  });

  it('ni se mueve a la etapa en la que ya está', () => {
    expect(
      puedeMover(EtapaCrm.ENTREGADO, EtapaCrm.ENTREGADO, 'humano').permitido,
    ).toBe(false);
  });
});

describe('el embudo sigue al despacho', () => {
  it('cada estado de la logística tiene su etapa', () => {
    expect(etapaDesdeDespacho('EN_CAMINO')).toBe(EtapaCrm.EN_RUTA);
    expect(etapaDesdeDespacho('EN_AGENCIA')).toBe(EtapaCrm.EN_RUTA);
    expect(etapaDesdeDespacho('EN_DESTINO')).toBe(EtapaCrm.EN_RUTA);
    expect(etapaDesdeDespacho('ENTREGADO')).toBe(EtapaCrm.ENTREGADO);
    // Un envío devuelto se reprograma: el pedido sigue vivo.
    expect(etapaDesdeDespacho('DEVUELTO')).toBe(EtapaCrm.REPROGRAMADO);
  });

  it('PREPARANDO no mueve el embudo: el encargado ya decidió despachar', () => {
    expect(etapaDesdeDespacho('PREPARANDO')).toBeNull();
  });
});

describe('los automatismos no hacen retroceder un pedido', () => {
  it('una consulta suelta no devuelve a diagnosticado un pedido por despachar', () => {
    expect(esAvance(EtapaCrm.POR_DESPACHAR, EtapaCrm.DIAGNOSTICADO)).toBe(false);
  });

  it('cotizar sí avanza desde nuevo', () => {
    expect(esAvance(EtapaCrm.NUEVO, EtapaCrm.COTIZADO)).toBe(true);
  });

  it('un desvío se registra mientras el pedido no haya entrado a la operación', () => {
    expect(esAvance(EtapaCrm.NUEVO, EtapaCrm.FRIO)).toBe(true);
    expect(esAvance(EtapaCrm.COTIZADO, EtapaCrm.CONSULTADO_NO_HABIDO)).toBe(true);
  });

  it('pero NO le saca la etapa a un pedido ya en marcha', () => {
    // El cliente con el pedido por despachar pregunta por algo que no hay. La
    // consulta se guarda igual (es dato para reponer), pero si le cambiara la
    // etapa el pedido desaparecería de la columna del encargado.
    expect(
      esAvance(EtapaCrm.POR_DESPACHAR, EtapaCrm.CONSULTADO_NO_HABIDO),
    ).toBe(false);
    expect(esAvance(EtapaCrm.EN_RUTA, EtapaCrm.NO_CONTESTA)).toBe(false);
    expect(esAvance(EtapaCrm.DATOS_COMPLETOS, EtapaCrm.FRIO)).toBe(false);
  });

  it('desde un desvío se puede retomar el recorrido', () => {
    expect(esAvance(EtapaCrm.FRIO, EtapaCrm.COTIZADO)).toBe(true);
  });
});

import { medioDePago } from './leads-embudo.service';

describe('medio de pago del voucher validado', () => {
  it('traduce lo que leyó la IA a los nombres de la caja', () => {
    expect(medioDePago('Yape')).toBe('YAPE');
    expect(medioDePago('PLIN - Interbank')).toBe('PLIN');
    expect(medioDePago('BCP')).toBe('TRANSFERENCIA');
    expect(medioDePago(null)).toBe('TRANSFERENCIA');
  });
});

import { LeadsEmbudoService } from './leads-embudo.service';

describe('validar un voucher que no cuadra', () => {
  it('no asienta solo un monto leído mayor a lo pendiente', async () => {
    const pagos = { registrarPago: jest.fn() };
    const prisma: any = {
      leadComprobantePago: {
        findFirst: jest.fn().mockResolvedValue({
          id: 5, prospectoId: 1, conversacionId: 376, validadoEn: null,
          montoLeido: 500, medioLeido: 'Yape', operacionLeida: '08779795',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      leadPedidoBorrador: { findUnique: jest.fn().mockResolvedValue({ comprobanteId: 99 }) },
      comprobante: { findFirst: jest.fn().mockResolvedValue({ saldo: 90 }) },
      envioDespacho: { findUnique: jest.fn().mockResolvedValue({ id: 1, montoCOD: 100 }), update: jest.fn() },
      usuario: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const s = new LeadsEmbudoService(prisma, {} as any, pagos as any);
    const r: any = await s.validarPago(5, 89, { id: 157, nombre: 'Edwing' }, false);
    expect(pagos.registrarPago).not.toHaveBeenCalled();
    expect(prisma.envioDespacho.update).not.toHaveBeenCalled();
    expect(r.adelanto.registrado).toBe(false);
    expect(r.adelanto.motivo).toMatch(/confirma el monto a mano/);
  });
});

describe('validar el voucher de Yape del adelanto (validación del 20-10)', () => {
  function armarValidacion(pagosPrevios: number) {
    const pagos = { registrarPago: jest.fn().mockResolvedValue({}) };
    const prisma: any = {
      leadComprobantePago: {
        findFirst: jest.fn().mockResolvedValue({
          id: 8, prospectoId: 1, conversacionId: 606, validadoEn: null,
          montoLeido: 12, medioLeido: 'Yape', operacionLeida: '01300228',
        }),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      leadPedidoBorrador: { findUnique: jest.fn().mockResolvedValue({ comprobanteId: 22080 }) },
      comprobante: {
        findFirst: jest.fn().mockResolvedValue({ saldo: 24 }),
        update: jest.fn().mockResolvedValue({}),
      },
      pago: { count: jest.fn().mockResolvedValue(pagosPrevios) },
      envioDespacho: { findUnique: jest.fn().mockResolvedValue({ id: 1, montoCOD: 24 }), update: jest.fn() },
      usuario: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    return { s: new LeadsEmbudoService(prisma, {} as any, pagos as any), prisma, pagos };
  }

  it('registra el pago como YAPE, el despacho cobra el resto y la nota toma el medio', async () => {
    const { s, prisma, pagos } = armarValidacion(0);
    const r: any = await s.validarPago(8, 89, { id: 157, nombre: 'Edwing' }, false);
    expect(r.adelanto).toMatchObject({ registrado: true, monto: 12 });
    expect(pagos.registrarPago.mock.calls[0][1]).toMatchObject({ monto: 12, medioPago: 'YAPE', referencia: '01300228' });
    expect(prisma.envioDespacho.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { montoCOD: 12 } });
    expect(prisma.comprobante.update).toHaveBeenCalledWith({ where: { id: 22080 }, data: { medioPago: 'YAPE' } });
  });

  it('si la nota ya tenía pagos, no le cambia el medio', async () => {
    const { s, prisma } = armarValidacion(1);
    await s.validarPago(8, 89, { id: 157, nombre: 'Edwing' }, false);
    expect(prisma.comprobante.update).not.toHaveBeenCalled();
  });
});

describe('el mismo voucher no paga dos pedidos', () => {
  function armarDuplicado() {
    const pagos = { registrarPago: jest.fn().mockResolvedValue({}) };
    const prisma: any = {
      leadComprobantePago: {
        findFirst: jest.fn().mockResolvedValue({
          id: 9, prospectoId: 2, conversacionId: 700, validadoEn: null,
          montoLeido: 12, medioLeido: 'Yape', operacionLeida: '01300228',
        }),
        update: jest.fn().mockResolvedValue({}),
        // Ya hay otro pago validado con esa operación.
        count: jest.fn().mockResolvedValue(1),
      },
      leadPedidoBorrador: { findUnique: jest.fn().mockResolvedValue({ comprobanteId: 23000 }) },
      comprobante: { findFirst: jest.fn().mockResolvedValue({ saldo: 24 }), update: jest.fn().mockResolvedValue({}) },
      pago: { count: jest.fn().mockResolvedValue(0) },
      envioDespacho: { findUnique: jest.fn().mockResolvedValue({ id: 2, montoCOD: 24 }), update: jest.fn() },
      usuario: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    return { s: new LeadsEmbudoService(prisma, {} as any, pagos as any), pagos, prisma };
  }

  it('no lo asienta solo y explica por qué', async () => {
    const { s, pagos } = armarDuplicado();
    const r: any = await s.validarPago(9, 89, { id: 157 }, false);
    expect(pagos.registrarPago).not.toHaveBeenCalled();
    expect(r.adelanto.motivo).toMatch(/01300228 ya se usó/);
  });

  it('si quien valida confirma el monto, pasa', async () => {
    const { s, pagos } = armarDuplicado();
    await s.validarPago(9, 89, { id: 157 }, false, 12);
    expect(pagos.registrarPago).toHaveBeenCalled();
  });
});

describe('el voucher que llegó antes de registrar el pedido (NV01-00000028, 20-10)', () => {
  // La nota ya nació con ese Yape como adelanto: validarlo no lo vuelve a cobrar.
  function armarPrevio(recibidoEn: Date) {
    const pagos = { registrarPago: jest.fn().mockResolvedValue({}) };
    const prisma: any = {
      leadComprobantePago: {
        findFirst: jest.fn().mockResolvedValue({
          id: 10, prospectoId: 3, conversacionId: 800, validadoEn: null,
          montoLeido: 12, medioLeido: 'Yape', operacionLeida: '01300228', recibidoEn,
        }),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      leadPedidoBorrador: {
        findUnique: jest.fn().mockResolvedValue({
          comprobanteId: 24000,
          registradoEn: new Date('2026-10-20T15:00:00Z'),
        }),
      },
      comprobante: { findFirst: jest.fn().mockResolvedValue({ saldo: 12 }), update: jest.fn().mockResolvedValue({}) },
      pago: { count: jest.fn().mockResolvedValue(1) },
      envioDespacho: { findUnique: jest.fn().mockResolvedValue({ id: 3, montoCOD: 12 }), update: jest.fn() },
      usuario: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    return { s: new LeadsEmbudoService(prisma, {} as any, pagos as any), pagos, prisma };
  }
  const ANTES = new Date('2026-10-20T14:59:00Z');

  it('no lo asienta otra vez ni baja de nuevo lo que cobra la agencia', async () => {
    const { s, pagos, prisma } = armarPrevio(ANTES);
    const r: any = await s.validarPago(10, 89, { id: 157 }, false);
    expect(r.adelanto).toMatchObject({ registrado: true, monto: 12 });
    expect(pagos.registrarPago).not.toHaveBeenCalled();
    expect(prisma.envioDespacho.update).not.toHaveBeenCalled();
  });

  it('tampoco si quien valida confirma el mismo monto', async () => {
    const { s, pagos } = armarPrevio(ANTES);
    await s.validarPago(10, 89, { id: 157 }, false, 12);
    expect(pagos.registrarPago).not.toHaveBeenCalled();
  });

  it('si confirma más de lo leído, asienta solo la diferencia', async () => {
    const { s, pagos, prisma } = armarPrevio(ANTES);
    await s.validarPago(10, 89, { id: 157 }, false, 15);
    expect(pagos.registrarPago.mock.calls[0][1]).toMatchObject({ monto: 3 });
    expect(prisma.envioDespacho.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { montoCOD: 9 } });
  });

  it('si confirma menos de lo leído, avisa para corregir a mano', async () => {
    const { s, pagos } = armarPrevio(ANTES);
    const r: any = await s.validarPago(10, 89, { id: 157 }, false, 10);
    expect(pagos.registrarPago).not.toHaveBeenCalled();
    expect(r.adelanto.motivo).toMatch(/ya entró en la nota/);
  });

  it('un voucher que llegó DESPUÉS de registrar sí se asienta', async () => {
    const { s, pagos } = armarPrevio(new Date('2026-10-20T15:05:00Z'));
    await s.validarPago(10, 89, { id: 157 }, false);
    expect(pagos.registrarPago.mock.calls[0][1]).toMatchObject({ monto: 12 });
  });
});
