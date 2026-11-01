import { ForbiddenException } from '@nestjs/common';
import { EnvioDespachoService } from './envio-despacho.service';

// Con Takiy los avisos salen del número del negocio sin costo por mensaje:
// sus textos se editan sin el plan Corporativo. Lo demás sigue siendo del plan.
function armar({
  planOk,
  takiyActivo,
  evolution = false,
}: {
  planOk: boolean;
  takiyActivo: boolean;
  evolution?: boolean;
}) {
  const upsert = jest.fn(async (args: any) => ({ empresaId: 1, ...args.update }));
  const prisma = {
    empresa: {
      findUnique: jest.fn(async (args: any) =>
        args.select?.plan
          ? { plan: planOk ? { nombre: 'CORPORATIVO', features: [{ featureKey: 'tieneShalomGuias', enabled: true }] } : { nombre: 'BASICO', features: [] } }
          : { takiyActivo },
      ),
    },
    despachoMensajeTemplate: { upsert },
  };
  const whatsapp = {
    crearPlantillasDespachoEmpresa: jest.fn(async () => ({ creadas: [], existentes: [], errores: [] })),
    numeroNegocioActivo: jest.fn(async () => (evolution ? 'EVOLUTION' : null)),
  };
  const servicio = new EnvioDespachoService(prisma as never, {} as never, whatsapp as never, {} as never, {} as never);
  return { servicio, upsert, whatsapp };
}

const dto = {
  mensajeEnAgencia: 'Hola {{nombre}}, ya puede recoger',
  mensajeEnCaminoAgencia: 'Va a tu agencia {{agencia}}',
  notificarEnCamino: false,
  recordatorioRecojoDias: 3,
  pagoRepartidorPropio: 'Yape',
};

describe('editar mensajes de despacho', () => {
  it('sin plan y sin Takiy: sigue prohibido', async () => {
    const { servicio, upsert } = armar({ planOk: false, takiyActivo: false });
    await expect(servicio.upsertConfig(1, dto)).rejects.toBeInstanceOf(ForbiddenException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('sin plan pero con Takiy: guarda solo los textos y los avisos por estado', async () => {
    const { servicio, upsert, whatsapp } = armar({ planOk: false, takiyActivo: true });
    await servicio.upsertConfig(1, dto);
    expect(upsert.mock.calls[0][0].update).toEqual({
      mensajeEnAgencia: 'Hola {{nombre}}, ya puede recoger',
      mensajeEnCaminoAgencia: 'Va a tu agencia {{agencia}}',
      notificarEnCamino: false,
    });
    // Recordatorios y formas de pago son del plan: no se guardan ni crean plantillas.
    expect(whatsapp.crearPlantillasDespachoEmpresa).not.toHaveBeenCalled();
  });

  it('sin plan pero con Evolution conectado: igual que con Takiy', async () => {
    const { servicio, upsert, whatsapp } = armar({ planOk: false, takiyActivo: false, evolution: true });
    await servicio.upsertConfig(1, dto);
    expect(upsert.mock.calls[0][0].update).toEqual({
      mensajeEnAgencia: 'Hola {{nombre}}, ya puede recoger',
      mensajeEnCaminoAgencia: 'Va a tu agencia {{agencia}}',
      notificarEnCamino: false,
    });
    expect(whatsapp.crearPlantillasDespachoEmpresa).not.toHaveBeenCalled();
  });

  it('con plan: guarda todo como siempre', async () => {
    const { servicio, upsert } = armar({ planOk: true, takiyActivo: false });
    await servicio.upsertConfig(1, dto);
    expect(upsert.mock.calls[0][0].update).toEqual(dto);
  });
});
