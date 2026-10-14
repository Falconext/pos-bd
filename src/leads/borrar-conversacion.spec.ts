/**
 * Borrar un chat para poder volver a probarlo.
 *
 * El empresario prueba su IA escribiéndole como cliente, y hasta ahora cada
 * prueba quedaba pegada para siempre: la siguiente arrancaba con el
 * historial de la anterior, así que no se podía volver a ver el saludo
 * inicial ni repetir un flujo desde cero.
 *
 * Lo que de verdad hay que cuidar acá son dos cosas. La primera es el
 * aislamiento: el id de una conversación es un número chico y adivinable, y
 * si el borrado no comprueba la empresa, cualquier cliente de la plataforma
 * le borra el historial a otro.
 *
 * La segunda son los huérfanos. Mensajes, prospecto, borrador e historial de
 * etapas se van solos por las claves foráneas; `LeadDisparo`,
 * `LeadComprobantePago` y `LeadConsulta` NO —guardan el `conversacionId` sin
 * clave foránea— y si nadie las borra siguen apareciendo en los reportes
 * apuntando a una conversación que ya no existe.
 */
import { NotFoundException } from '@nestjs/common';
import { LeadsService } from './leads.service';

function armar(conv: Record<string, unknown> | null) {
  const borrados: string[] = [];
  const marcar = (tabla: string) => ({
    deleteMany: jest.fn(async () => {
      borrados.push(tabla);
      return { count: 1 };
    }),
  });
  const prisma: any = {
    leadConversacion: {
      findFirst: jest.fn().mockResolvedValue(conv),
      delete: jest.fn(async () => {
        borrados.push('LeadConversacion');
        return {};
      }),
    },
    leadDisparo: marcar('LeadDisparo'),
    leadComprobantePago: marcar('LeadComprobantePago'),
    leadConsulta: marcar('LeadConsulta'),
    // La transacción corre lo que se le pasa: acá ya está evaluado.
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const servicio = new LeadsService(
    prisma,
    {} as never,
    {} as never,
    {} as never,
  );
  return { servicio, prisma, borrados };
}

const CONV = {
  id: 69,
  telefonoProspecto: '51919755320',
  cantidadMensajes: 24,
};

describe('el aislamiento entre empresas', () => {
  it('busca la conversación filtrando por la empresa del token', async () => {
    const { servicio, prisma } = armar(CONV);
    await servicio.eliminarConversacion(89, 69);
    expect(prisma.leadConversacion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 69, empresaId: 89 } }),
    );
  });

  it('una conversación de otra empresa es 404, no se borra', async () => {
    // El id es un número chico y adivinable: sin esto, el 69 de una empresa
    // se lo borra cualquiera.
    const { servicio, borrados } = armar(null);
    await expect(servicio.eliminarConversacion(7, 69)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(borrados).toHaveLength(0);
  });
});

describe('qué se lleva el borrado', () => {
  it('borra también las tablas que no tienen clave foránea', async () => {
    const { servicio, borrados } = armar(CONV);
    await servicio.eliminarConversacion(89, 69);
    for (const tabla of [
      'LeadDisparo',
      'LeadComprobantePago',
      'LeadConsulta',
      'LeadConversacion',
    ]) {
      expect(borrados).toContain(tabla);
    }
  });

  it('cada limpieza va acotada a la empresa Y a la conversación', async () => {
    // Sin el conversacionId se borrarían los disparadores de TODA la empresa.
    const { servicio, prisma } = armar(CONV);
    await servicio.eliminarConversacion(89, 69);
    for (const tabla of ['leadDisparo', 'leadComprobantePago', 'leadConsulta']) {
      expect(prisma[tabla].deleteMany).toHaveBeenCalledWith({
        where: { empresaId: 89, conversacionId: 69 },
      });
    }
  });

  it('todo va en una transacción: o se borra entero o no se borra', async () => {
    // A medias quedaría una conversación sin mensajes, o peor, mensajes sin
    // conversación.
    const { servicio, prisma } = armar(CONV);
    await servicio.eliminarConversacion(89, 69);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('devuelve qué se borró, para poder decírselo a quien apretó el botón', async () => {
    const { servicio } = armar(CONV);
    await expect(servicio.eliminarConversacion(89, 69)).resolves.toMatchObject({
      eliminada: true,
      telefono: '51919755320',
      mensajes: 24,
    });
  });
});
