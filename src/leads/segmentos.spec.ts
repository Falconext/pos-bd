/**
 * Segmentos: a quién le llega un envío masivo.
 *
 * Se cuida que el filtro diga exactamente lo que el empresario eligió (un
 * "no compró" que deja pasar a quien compró en caja le manda la promo de
 * bienvenida a un cliente de años) y que la cuenta de "recibirán" use las
 * mismas reglas que el envío: baja, tope e Instagram sin ventana.
 */
import {
  cumpleFiltros,
  exclusionDe,
  normalizarFiltros,
  HechosContacto,
} from './segmentos';

const AHORA = new Date('2026-10-27T15:00:00Z');
const haceDias = (d: number) => new Date(AHORA.getTime() - d * 24 * 3600_000);

const hechos = (h: Partial<HechosContacto> = {}): HechosContacto => ({
  etiquetaIds: [],
  compras: [],
  consultas: [],
  ultimoMensajeDelCliente: haceDias(1),
  ...h,
});

describe('normalizarFiltros', () => {
  it('descarta ids inválidos, claves vacías y valores fuera de la lista', () => {
    expect(
      normalizarFiltros({
        etiquetas: { incluir: [1, '2', -3, 'x', 1], excluir: [] },
        temperaturas: ['TIBIO', 'HIRVIENDO'],
        canales: ['WHATSAPP', 'TELEGRAM'],
        actividad: { minDias: '', maxDias: 30 },
        compras: { estado: 'quizas' },
      }),
    ).toEqual({
      etiquetas: { incluir: [1, 2], modo: 'alguna' },
      temperaturas: ['TIBIO'],
      canales: ['WHATSAPP'],
      actividad: { maxDias: 30 },
    });
  });

  it('las etapas se validan contra las del embudo', () => {
    expect(
      normalizarFiltros({ etapas: ['COTIZADO', 'INVENTADA'] }, [
        'NUEVO',
        'COTIZADO',
      ]),
    ).toEqual({
      etapas: ['COTIZADO'],
    });
  });

  it('basura entera da un filtro vacío (todos los contactos)', () => {
    expect(normalizarFiltros(null)).toEqual({});
    expect(normalizarFiltros('hola')).toEqual({});
  });
});

describe('cumpleFiltros — etiquetas', () => {
  it('"alguna" pide al menos una; "todas", todas', () => {
    const h = hechos({ etiquetaIds: [1] });
    expect(
      cumpleFiltros(
        { etiquetas: { incluir: [1, 2], modo: 'alguna' } },
        h,
        AHORA,
      ),
    ).toBe(true);
    expect(
      cumpleFiltros(
        { etiquetas: { incluir: [1, 2], modo: 'todas' } },
        h,
        AHORA,
      ),
    ).toBe(false);
  });

  it('excluir saca a quien tenga cualquiera de esas', () => {
    expect(
      cumpleFiltros(
        { etiquetas: { excluir: [9] } },
        hechos({ etiquetaIds: [9] }),
        AHORA,
      ),
    ).toBe(false);
  });
});

describe('cumpleFiltros — actividad', () => {
  it('"hace más de 15 días" deja fuera al que escribió ayer', () => {
    const f = { actividad: { minDias: 15 } };
    expect(
      cumpleFiltros(f, hechos({ ultimoMensajeDelCliente: haceDias(1) }), AHORA),
    ).toBe(false);
    expect(
      cumpleFiltros(
        f,
        hechos({ ultimoMensajeDelCliente: haceDias(20) }),
        AHORA,
      ),
    ).toBe(true);
  });

  it('sin mensajes del cliente no entra a un filtro de actividad', () => {
    expect(
      cumpleFiltros(
        { actividad: { maxDias: 30 } },
        hechos({ ultimoMensajeDelCliente: null }),
        AHORA,
      ),
    ).toBe(false);
  });
});

describe('cumpleFiltros — compras', () => {
  const perfume = { fecha: haceDias(10), productoIds: [50], categoriaIds: [7] };

  it('"compró" exige una compra; "no compró", ninguna', () => {
    expect(
      cumpleFiltros(
        { compras: { estado: 'compro' } },
        hechos({ compras: [perfume] }),
        AHORA,
      ),
    ).toBe(true);
    expect(
      cumpleFiltros({ compras: { estado: 'compro' } }, hechos(), AHORA),
    ).toBe(false);
    expect(
      cumpleFiltros(
        { compras: { estado: 'no_compro' } },
        hechos({ compras: [perfume] }),
        AHORA,
      ),
    ).toBe(false);
    expect(
      cumpleFiltros({ compras: { estado: 'no_compro' } }, hechos(), AHORA),
    ).toBe(true);
  });

  it('por categoría y por plazo', () => {
    const h = hechos({ compras: [perfume] });
    expect(
      cumpleFiltros(
        { compras: { estado: 'compro', categoriaIds: [7] } },
        h,
        AHORA,
      ),
    ).toBe(true);
    expect(
      cumpleFiltros(
        { compras: { estado: 'compro', categoriaIds: [8] } },
        h,
        AHORA,
      ),
    ).toBe(false);
    expect(
      cumpleFiltros({ compras: { estado: 'compro', dias: 5 } }, h, AHORA),
    ).toBe(false);
  });

  it('"no compró perfume" deja pasar a quien compró otra cosa', () => {
    const h = hechos({
      compras: [{ fecha: haceDias(3), productoIds: [99], categoriaIds: [3] }],
    });
    expect(
      cumpleFiltros(
        { compras: { estado: 'no_compro', categoriaIds: [7] } },
        h,
        AHORA,
      ),
    ).toBe(true);
  });
});

describe('cumpleFiltros — consultas', () => {
  it('"pidió y no había" separa lo no habido de lo que sí había', () => {
    const h = hechos({
      consultas: [{ fecha: haceDias(2), productoId: 5, hubo: true }],
    });
    expect(cumpleFiltros({ consultas: { productoIds: [5] } }, h, AHORA)).toBe(
      true,
    );
    expect(
      cumpleFiltros(
        { consultas: { productoIds: [5], soloNoHabidos: true } },
        h,
        AHORA,
      ),
    ).toBe(false);
  });
});

describe('exclusionDe', () => {
  const base = {
    interno: false,
    deBaja: false,
    marketingRecientes: 0,
    tope: 2,
    canal: 'WHATSAPP',
    ventanaAbierta: false,
  };

  it('WhatsApp con la ventana cerrada sí recibe (va por plantilla)', () => {
    expect(exclusionDe(base)).toBeNull();
  });

  it('la baja manda sobre el tope', () => {
    expect(exclusionDe({ ...base, deBaja: true, marketingRecientes: 5 })).toBe(
      'BAJA',
    );
  });

  it('al llegar al tope ya no recibe', () => {
    expect(exclusionDe({ ...base, marketingRecientes: 2 })).toBe('TOPE');
    expect(exclusionDe({ ...base, marketingRecientes: 1 })).toBeNull();
  });

  it('Instagram sin ventana no recibe; con ventana sí', () => {
    expect(exclusionDe({ ...base, canal: 'INSTAGRAM' })).toBe('SIN_VENTANA');
    expect(
      exclusionDe({ ...base, canal: 'INSTAGRAM', ventanaAbierta: true }),
    ).toBeNull();
  });

  it('los números del negocio nunca reciben', () => {
    expect(exclusionDe({ ...base, interno: true })).toBe('INTERNO');
  });
});
