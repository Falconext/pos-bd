import { ajustarPuntaje, rangoTemperatura, type HechosLead } from './temperatura-por-hechos';
import { estadoDesdeScore } from './leads-ia.service';

const base: HechosLead = {
  etapa: 'NUEVO',
  pedidoRegistrado: false,
  visitaAgendada: false,
  retomaAgendado: false,
  mensajesCliente: 6,
};

/** Lo que termina viendo el negocio, con la IA puntuando alto como siempre. */
const temperatura = (h: Partial<HechosLead>, puntajeIa = 96) => {
  const r = rangoTemperatura({ ...base, ...h });
  return { estado: estadoDesdeScore(ajustarPuntaje(puntajeIa, r)), ...r };
};

describe('la temperatura sale de lo que el cliente hizo', () => {
  it('una consulta suelta es fría aunque la IA la puntúe 96 (Hierba Sana, 26-10)', () => {
    expect(temperatura({ mensajesCliente: 1 })).toMatchObject({ estado: 'FRIO', alertar: false });
    expect(temperatura({ etapa: 'DIAGNOSTICADO', mensajesCliente: 2 }).estado).toBe('FRIO');
  });

  it('conversar y pedir precio, sin comprometerse, es tibio como mucho', () => {
    expect(temperatura({ etapa: 'COTIZADO' })).toMatchObject({ estado: 'TIBIO', alertar: false });
  });

  it('dejó sus datos: caliente y se avisa', () => {
    expect(temperatura({ etapa: 'DATOS_COMPLETOS' }, 30)).toMatchObject({
      estado: 'CALIENTE',
      motivo: 'Dejó sus datos',
      alertar: true,
    });
  });

  it('agendó fecha para pagar: más caliente que solo dejar datos', () => {
    const r = temperatura({ etapa: 'DATOS_COMPLETOS', retomaAgendado: true }, 20);
    expect(r.estado).toBe('CALIENTE');
    expect(r.piso).toBeGreaterThan(rangoTemperatura({ ...base, etapa: 'DATOS_COMPLETOS' }).piso);
  });

  it('agendó entrega o visita: lo más caliente', () => {
    expect(temperatura({ pedidoRegistrado: true }, 10)).toMatchObject({ estado: 'CALIENTE', piso: 95, motivo: 'Agendó su entrega' });
    expect(temperatura({ etapa: 'PENDIENTE_VALIDACION_PAGO' }, 10).motivo).toBe('Agendó su entrega');
    expect(temperatura({ visitaAgendada: true, pedidoRegistrado: true }, 10).motivo).toBe('Agendó su visita a la tienda');
  });

  it('los que dejaron de contestar no se avisan como calientes', () => {
    expect(temperatura({ etapa: 'NO_CONTESTA' }).estado).toBe('FRIO');
  });

  it('un cliente ya entregado no dispara "lead caliente"', () => {
    expect(temperatura({ etapa: 'ENTREGADO' })).toMatchObject({ alertar: false });
  });
});
