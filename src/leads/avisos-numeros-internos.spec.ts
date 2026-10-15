/**
 * Al número de pruebas del negocio no se le manda publicidad.
 *
 * Lo pidió el empresario de Hierba Sana con todas las letras: "mi cliente de
 * prueba es Estilo Colecta con el número +51 919 755 320, a este número sí
 * sería bueno desactivar los recordatorios o plantillas".
 *
 * Tiene razón y no es solo comodidad: mientras prueba el bot haciéndose pasar
 * por cliente, deja cotizaciones a medias a propósito. Cada una le agendaba
 * un recordatorio de recuperación, y a los 25 días uno de recompra por una
 * compra que nunca existió. Publicidad que se manda sola a sí mismo.
 *
 * Ya estaban fuera del embudo; esto cierra la otra mitad.
 */
import { LeadsDisparadoresService } from './leads-disparadores.service';
import { TipoDisparo } from './leads-disparadores';

const ADMIN = '955947892';
const PRUEBA = '51919755320'; // Estilo Colecta
const CLIENTE = '51991065217';

function armar() {
  const upsert = jest.fn().mockResolvedValue({ id: 1 });
  const prisma: any = {
    usuario: { findMany: jest.fn().mockResolvedValue([{ celular: ADMIN }]) },
    empresa: {
      findUnique: jest.fn().mockResolvedValue({
        iaVentasConfigJson: { numerosInternos: [PRUEBA] },
      }),
    },
    leadDisparo: { upsert },
  };
  const servicio = new LeadsDisparadoresService(
    prisma,
    {} as never,
    {} as never,
  );
  return { servicio, prisma, upsert };
}

const base = {
  empresaId: 89,
  tipo: TipoDisparo.RECUPERAR_COTIZACION,
  referencia: 'conversacion:1',
};

describe('a quién se le agenda un aviso', () => {
  it('al número de pruebas NO se le agenda nada', async () => {
    const { servicio, upsert } = armar();
    const r = await servicio.programar({ ...base, telefono: PRUEBA });
    expect(r).toEqual({ programado: false, motivo: 'número interno del negocio' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('al celular del dueño tampoco, venga como venga escrito', async () => {
    const { servicio, upsert } = armar();
    await servicio.programar({ ...base, telefono: '51955947892' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('a un cliente de verdad sí', async () => {
    // Si esto se rompe, se deja de recuperar cotizaciones: es el disparador
    // de mayor retorno de todos.
    const { servicio, upsert } = armar();
    const r = await servicio.programar({ ...base, telefono: CLIENTE });
    expect(r).not.toMatchObject({ motivo: 'número interno del negocio' });
    expect(upsert).toHaveBeenCalled();
  });

  it('si la base falla se agenda igual: no se pierde un cliente por una consulta', async () => {
    const { servicio, prisma, upsert } = armar();
    prisma.usuario.findMany.mockRejectedValue(new Error('sin conexión'));
    await servicio.programar({ ...base, telefono: CLIENTE });
    expect(upsert).toHaveBeenCalled();
  });

  it('vale para todos los tipos de aviso, no solo la cotización', async () => {
    const { servicio, upsert } = armar();
    for (const tipo of [
      TipoDisparo.RECOMPRA,
      TipoDisparo.POST_ENTREGA,
      TipoDisparo.VUELTA_DISPONIBILIDAD,
    ]) {
      await servicio.programar({ ...base, tipo, telefono: PRUEBA });
    }
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('esNumeroDeLaEmpresa', () => {
  it('reconoce al dueño y al número de pruebas, no al cliente', async () => {
    const { servicio } = armar();
    await expect(servicio.esNumeroDeLaEmpresa(89, '51955947892')).resolves.toBe(true);
    await expect(servicio.esNumeroDeLaEmpresa(89, PRUEBA)).resolves.toBe(true);
    await expect(servicio.esNumeroDeLaEmpresa(89, CLIENTE)).resolves.toBe(false);
  });
});
