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
