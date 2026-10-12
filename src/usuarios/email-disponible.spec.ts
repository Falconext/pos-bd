/**
 * Avisar que el correo ya está tomado, antes de guardar.
 *
 * El correo es único en toda la plataforma porque es con lo que se entra al
 * sistema. Si la empresa A da de alta a vendedor1@gmail.com, la empresa B ya no
 * puede: son negocios distintos, pero sería la misma puerta de entrada.
 *
 * Eso no se podía cambiar sin romper el login. Lo que sí se podía es dejar de
 * hacérselo descubrir al empresario recién al pulsar Guardar, con todo el
 * formulario lleno.
 */
import { UsersService } from './usuarios.service';

function armar(existente: any = null) {
  const consultado: any = {};
  const prisma: any = {
    usuario: {
      findFirst: jest.fn().mockImplementation((args: any) => {
        consultado.where = args?.where;
        consultado.select = args?.select;
        return Promise.resolve(existente);
      }),
    },
  };
  const service: any = Object.create(UsersService.prototype);
  service.prisma = prisma;
  return { service, consultado };
}

const preguntar = (service: any, email: string, excluir?: number) =>
  UsersService.prototype.emailDisponible.call(service, email, excluir);

describe('Correo de usuario · disponibilidad', () => {
  it('un correo libre se puede usar', async () => {
    const { service } = armar(null);
    expect(await preguntar(service, 'nuevo@gmail.com')).toEqual({ disponible: true });
  });

  it('un correo que ya usa otra empresa no se puede', async () => {
    const { service } = armar({ id: 9 });
    expect(await preguntar(service, 'vendedor1@gmail.com')).toEqual({ disponible: false });
  });

  it('no distingue mayúsculas: VENDEDOR1 y vendedor1 son la misma puerta', async () => {
    const { service, consultado } = armar({ id: 9 });
    await preguntar(service, 'VENDEDOR1@gmail.com');
    expect(consultado.where?.email?.mode).toBe('insensitive');
  });

  it('se limpian los espacios de un correo pegado', async () => {
    const { service, consultado } = armar(null);
    await preguntar(service, '  nuevo@gmail.com  ');
    expect(consultado.where?.email?.equals).toBe('nuevo@gmail.com');
  });

  it('al editar, su propio correo no se marca como ocupado', async () => {
    const { service } = armar({ id: 7 });
    expect(await preguntar(service, 'suyo@gmail.com', 7)).toEqual({ disponible: true });
    expect(await preguntar(service, 'suyo@gmail.com', 8)).toEqual({ disponible: false });
  });

  it('un campo vacío no consulta nada ni marca error', async () => {
    const { service, consultado } = armar({ id: 9 });
    expect(await preguntar(service, '')).toEqual({ disponible: true });
    expect(consultado.where).toBeUndefined();
  });

  it('solo responde si está libre: nunca de quién es el correo', async () => {
    const { service, consultado } = armar({ id: 9, nombre: 'Otro', empresaId: 77 });
    const r: any = await preguntar(service, 'vendedor1@gmail.com');
    expect(Object.keys(r)).toEqual(['disponible']);
    // Y ni siquiera se traen esos datos de la base.
    expect(consultado.select).toEqual({ id: true });
  });
});
