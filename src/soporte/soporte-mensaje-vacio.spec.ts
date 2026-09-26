/**
 * Un mensaje de solo espacios no se guardaba, pero el servidor respondía OK: el
 * que escribía veía su mensaje desaparecer sin ninguna explicación. Ahora se
 * rechaza con un motivo, para que la pantalla pueda decírselo.
 */
import { SoporteService } from './soporte.service';

const servicio = () =>
  new SoporteService({} as any, { emitirAEmpresa: jest.fn(), emitirASistema: jest.fn() } as any);

describe('Soporte · mensaje vacío', () => {
  it.each(['', '   ', '\n\t '])('el empresario no puede enviar %j', async (texto) => {
    await expect(servicio().enviarMensajeEmpresa(1, 1, texto)).rejects.toThrow(
      'Escribe un mensaje',
    );
  });

  it.each(['', '  '])('Krezka tampoco puede responder %j', async (texto) => {
    await expect(servicio().enviarMensajeSistema(1, null, 1, texto)).rejects.toThrow(
      'Escribe un mensaje',
    );
  });
});
