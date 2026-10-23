/**
 * Cuando la IA deriva, alguien tiene que enterarse FUERA del panel.
 *
 * Derivar apaga el bot: a partir de ahí el cliente le escribe a nadie. Si el
 * único aviso es la notificación in-app, basta con que nadie esté mirando el
 * panel para que esa persona quede esperando. El empresario de Hierba Sana lo
 * pidió con todas las letras: "que las notificaciones lleguen a casa
 * naturista", a su supervisor de ventas.
 *
 * Lo que se defiende acá, además del aviso: que el número salga de la
 * configuración de cada empresa y nunca del código. Un número escrito en el
 * código significa que el siguiente cliente necesita un despliegue para
 * recibir sus propios avisos.
 */
import { LeadsAlertaService } from './leads-alerta.service';

function armar(opts: {
  admins?: ({ celular: string | null })[];
} = {}) {
  const enviados: { numero: string; texto: string; empresaId?: number }[] = [];
  const prisma = {
    usuario: {
      findMany: jest.fn().mockResolvedValue(
        opts.admins ?? [{ celular: '955947892' }],
      ),
    },
  } as never;
  const whatsapp = {
    enviarTexto: jest.fn(async (numero: string, texto: string, empresaId?: number) => {
      enviados.push({ numero, texto, empresaId });
      return { success: true };
    }),
  } as never;
  const config = { get: () => 'https://app.krezka.com' } as never;
  return {
    servicio: new LeadsAlertaService(prisma, whatsapp, config),
    enviados,
  };
}

const BASE = {
  empresaId: 89,
  telefonoProspecto: '51991065217',
  nombreProspecto: 'Diego Ortega',
  motivo: 'mayorista',
  detalle: 'Botica San Lucas, Trujillo. 10 docenas surtidas.',
};

describe('a quién se le avisa', () => {
  it('al supervisor configurado, cuando lo hay', async () => {
    const { servicio, enviados } = armar();
    await servicio.avisarDerivacion({
      ...BASE,
      supervisorTelefono: '955947892',
    });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].numero).toBe('955947892');
    // Con las credenciales de WhatsApp de ESA empresa, no las globales.
    expect(enviados[0].empresaId).toBe(89);
  });

  it('a los administradores cuando no hay supervisor configurado', async () => {
    // Para que una empresa que no configuró nada igual se entere.
    const { servicio, enviados } = armar({
      admins: [{ celular: '999111222' }, { celular: '999333444' }],
    });
    await servicio.avisarDerivacion(BASE);
    expect(enviados.map((e) => e.numero).sort()).toEqual([
      '999111222',
      '999333444',
    ]);
  });

  it('el supervisor reemplaza a los admins, no se suma', async () => {
    // Si no, el dueño recibe el mismo aviso dos veces por cada derivación.
    const { servicio, enviados } = armar({
      admins: [{ celular: '999111222' }],
    });
    await servicio.avisarDerivacion({
      ...BASE,
      supervisorTelefono: '955947892',
    });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].numero).toBe('955947892');
  });

  it('no manda dos veces al mismo número escrito distinto', async () => {
    const { servicio, enviados } = armar({
      admins: [{ celular: '955947892' }, { celular: '+51 955 947 892' }],
    });
    await servicio.avisarDerivacion(BASE);
    expect(enviados).toHaveLength(1);
  });

  it('sin ningún número no revienta: una derivación no puede fallar por esto', async () => {
    const { servicio, enviados } = armar({ admins: [{ celular: null }] });
    await expect(servicio.avisarDerivacion(BASE)).resolves.toBeUndefined();
    expect(enviados).toHaveLength(0);
  });

  it('si WhatsApp falla, tampoco', async () => {
    const prisma = {
      usuario: { findMany: async () => [{ celular: '955947892' }] },
    } as never;
    const whatsapp = {
      enviarTexto: async () => {
        throw new Error('token vencido');
      },
    } as never;
    const servicio = new LeadsAlertaService(prisma, whatsapp, {
      get: () => 'https://app.krezka.com',
    } as never);
    await expect(servicio.avisarDerivacion(BASE)).resolves.toBeUndefined();
  });
});

describe('qué dice el aviso', () => {
  it('trae lo que hace falta para retomar sin abrir el panel', async () => {
    const { servicio, enviados } = armar();
    await servicio.avisarDerivacion({ ...BASE, supervisorTelefono: '955947892' });
    const t = enviados[0].texto;
    expect(t).toContain('Diego Ortega');
    expect(t).toContain('mayorista');
    expect(t).toContain('Botica San Lucas');
    // Su número sigue a la vista, pero a contestar se manda a la bandeja: con
    // el wa.me le escribían desde un WhatsApp personal, otro número.
    expect(t).toContain('https://wa.me/51991065217');
    expect(t).toContain('/administrador/leads/chats');
    expect(t).not.toContain('Escríbele tú');
  });

  it('el motivo se lee, no se muestra con guiones bajos', async () => {
    const { servicio, enviados } = armar();
    await servicio.avisarDerivacion({
      ...BASE,
      motivo: 'seguimiento_de_pedido',
      supervisorTelefono: '955947892',
    });
    expect(enviados[0].texto).toContain('seguimiento de pedido');
    expect(enviados[0].texto).not.toContain('seguimiento_de_pedido');
  });

  it('sin nombre ni detalle sigue siendo útil', async () => {
    const { servicio, enviados } = armar();
    await servicio.avisarDerivacion({
      empresaId: 89,
      telefonoProspecto: '51991065217',
      motivo: 'reclamo',
      supervisorTelefono: '955947892',
    });
    const t = enviados[0].texto;
    expect(t).toContain('Sin nombre');
    expect(t).toContain('https://wa.me/51991065217');
    expect(t).not.toContain('undefined');
    expect(t).not.toContain('null');
  });

  it('no lleva ningún número ni nombre escrito en el código', async () => {
    // La prueba de que esto sirve para el siguiente cliente y no solo para
    // Hierba Sana.
    const { servicio, enviados } = armar({ admins: [{ celular: '999111222' }] });
    await servicio.avisarDerivacion({
      empresaId: 7,
      telefonoProspecto: '51988777666',
      nombreProspecto: 'Otro negocio',
      motivo: 'reclamo',
    });
    const t = enviados[0].texto;
    for (const rastro of ['Hierba Sana', '955947892', 'Claudio']) {
      expect(t).not.toContain(rastro);
    }
  });
});

describe('cliente de alto riesgo (decisión de Hierba Sana, 19-10)', () => {
  it('avisa al mismo supervisor, pide seguimiento y dice que la IA sigue', async () => {
    const { servicio, enviados } = armar();
    await servicio.avisarAltoRiesgo({
      ...BASE,
      motivo: 'diabetes e hipertensión, toma metformina y losartán',
      detalle: 'Diabetes Colesterol Presión - Natural Medix',
      supervisorTelefono: '955947892',
    });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].numero).toBe('955947892');
    expect(enviados[0].texto).toContain('ALTO RIESGO');
    expect(enviados[0].texto).toContain('metformina');
    expect(enviados[0].texto).toContain('La IA sigue atendiendo');
    // No es una derivación: no dice que la IA dejó de responder.
    expect(enviados[0].texto).not.toContain('dejó de responder');
  });
});

describe('con la ventana de 24h cerrada, el aviso sale por plantilla', () => {
  // 19-10: el supervisor de Hierba Sana no recibió ningún aviso desde el
  // sábado: el texto libre fallaba y solo quedaba en el log.
  it('si el texto falla, manda aviso_equipo con el resumen y el cliente en una línea', async () => {
    const plantillas: any[] = [];
    const prisma = { usuario: { findMany: jest.fn().mockResolvedValue([{ celular: '955947892' }]) } } as never;
    const whatsapp = {
      enviarTexto: jest.fn(async () => ({ success: false, error: '(#131047) Re-engagement message' })),
      enviarPlantilla: jest.fn(async (...a: any[]) => {
        plantillas.push(a);
        return { success: true };
      }),
    } as never;
    const servicio = new LeadsAlertaService(prisma, whatsapp, { get: () => 'https://app.krezka.com' } as never);
    await servicio.avisarAltoRiesgo({
      ...BASE,
      motivo: 'diabetes e hipertensión,\ntoma metformina',
      detalle: 'Diabetizan',
      supervisorTelefono: '955947892',
    });
    expect(plantillas).toHaveLength(1);
    const [numero, nombre, idioma, params, empresaId] = plantillas[0];
    expect([numero, nombre, idioma, empresaId]).toEqual(['955947892', 'aviso_equipo', 'es', 89]);
    expect(params[0]).toMatch(/alto riesgo.*metformina.*Diabetizan/);
    expect(params[0]).not.toMatch(/\n/);
    expect(params[1]).toBe('Diego Ortega · 51991065217');
  });

  it('si el texto llega, no gasta la plantilla', async () => {
    const { servicio } = armar();
    const w: any = (servicio as any).whatsapp;
    w.enviarPlantilla = jest.fn();
    await servicio.avisarDerivacion({ ...BASE, supervisorTelefono: '955947892' });
    expect(w.enviarPlantilla).not.toHaveBeenCalled();
  });
});
