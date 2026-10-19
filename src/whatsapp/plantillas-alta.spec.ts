/**
 * El alta de plantillas, en paralelo.
 *
 * Pasó en producción: dar de alta las 7 plantillas de la IA de Ventas tardaba
 * más de 12 segundos porque se creaban una tras otra. El servidor las creaba
 * todas, pero el navegador cortaba antes y le decía al usuario "no se pudieron
 * dar de alta" — un error que miente sobre algo que sí funcionó e invita a
 * reintentarlo. Estos tests fijan las dos cosas que lo arreglan: que las
 * llamadas salgan juntas, y que "ya existe" no cuente como fallo.
 */
import axios from 'axios';
import { WhatsAppService } from './whatsapp.service';

jest.mock('axios');
const post = axios.post as jest.Mock;

/** El servicio sin su módulo: nada de lo que probamos toca Prisma ni config. */
function servicio(): WhatsAppService {
  const config = { get: () => undefined } as never;
  return new WhatsAppService({} as never, config);
}

const alta = (s: WhatsAppService) =>
  s.crearPlantillasIaVentas('WABA-1', 'TOKEN') as Promise<{
    creadas: string[];
    existentes: string[];
    errores: string[];
  }>;

describe('dar de alta las plantillas de IA de Ventas', () => {
  beforeEach(() => post.mockReset());

  it('manda todas las llamadas juntas, no una esperando a la otra', async () => {
    let enVuelo = 0;
    let maximoEnVuelo = 0;
    post.mockImplementation(() => {
      maximoEnVuelo = Math.max(maximoEnVuelo, ++enVuelo);
      return new Promise((resolve) =>
        setImmediate(() => {
          enVuelo--;
          resolve({ data: {} });
        }),
      );
    });

    const r = await alta(servicio());

    // Secuencial, el máximo en vuelo sería 1 y el navegador se rendía.
    expect(maximoEnVuelo).toBe(r.creadas.length);
    expect(maximoEnVuelo).toBeGreaterThan(1);
  });

  it('las 7 plantillas del catálogo, ninguna de menos', async () => {
    post.mockResolvedValue({ data: {} });

    const r = await alta(servicio());

    expect(r.creadas).toEqual(
      expect.arrayContaining([
        'producto_disponible',
        'post_entrega_resena',
        'recuperar_cotizacion',
        'recompra_25',
        'carrito_en_espera',
        'reactivacion_45',
        'reanudar_atencion',
      ]),
    );
    expect(r.errores).toEqual([]);
  });

  it('las que Meta trata como promoción van declaradas MARKETING', async () => {
    // Las mandábamos como UTILITY y Meta las reclasificaba al revisarlas, con
    // lo cual el panel prometía un precio de UTILITY que no era el real.
    post.mockResolvedValue({ data: {} });

    await alta(servicio());

    const categoria = (nombre: string) =>
      post.mock.calls.find((c) => c[1].name === nombre)?.[1].category;
    expect(categoria('producto_disponible')).toBe('MARKETING');
    expect(categoria('recompra_25')).toBe('MARKETING');
    expect(categoria('reactivacion_45')).toBe('MARKETING');
    // Estas sí son UTILITY: hablan de un pedido que el cliente ya empezó.
    expect(categoria('reanudar_atencion')).toBe('UTILITY');
    expect(categoria('recuperar_cotizacion')).toBe('UTILITY');
    expect(categoria('carrito_en_espera')).toBe('UTILITY');
    expect(categoria('post_entrega_resena')).toBe('UTILITY');
  });

  it('"ya existe" es idempotencia, no un error', async () => {
    post.mockRejectedValue({
      response: { data: { error: { error_subcode: 2388023 } } },
    });

    const r = await alta(servicio());

    expect(r.creadas).toEqual([]);
    expect(r.existentes).toHaveLength(9);
    expect(r.errores).toEqual([]);
  });

  it('un rechazo real dice de QUÉ plantilla y por qué', async () => {
    post.mockImplementation((_url: string, cuerpo: { name: string }) =>
      cuerpo.name === 'recompra_25'
        ? Promise.reject({
            response: {
              data: { error: { error_user_msg: 'Categoría no permitida' } },
            },
          })
        : Promise.resolve({ data: {} }),
    );

    const r = await alta(servicio());

    expect(r.errores).toEqual(['recompra_25: Categoría no permitida']);
    expect(r.creadas).toHaveLength(8);
  });

  it('una que falla no se lleva a las otras', async () => {
    // Con Promise.all a secas, el primer rechazo mata el resto.
    post.mockImplementation((_url: string, cuerpo: { name: string }) =>
      cuerpo.name === 'producto_disponible'
        ? Promise.reject(new Error('red caída'))
        : Promise.resolve({ data: {} }),
    );

    const r = await alta(servicio());

    expect(r.creadas).toHaveLength(8);
    expect(r.errores).toHaveLength(1);
  });
});
