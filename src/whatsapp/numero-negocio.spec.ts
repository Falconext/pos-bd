import {
  NumeroNegocioService,
  consejoNumeroNegocio,
} from './numero-negocio.service';
import { WhatsAppService } from './whatsapp.service';

function armar(o: {
  evolutionConectado: boolean;
  evolution?: any;
  takiy?: boolean;
  takiyOk?: boolean;
}) {
  const prisma = {
    empresa: {
      findUnique: jest.fn(async () =>
        o.takiy
          ? { takiyActivo: true, takiyAppKey: 'app', takiyAuthKey: 'auth' }
          : { takiyActivo: false },
      ),
    },
  };
  const evolution = {
    conectado: jest.fn(async () => o.evolutionConectado),
    enviar: jest.fn(async () => o.evolution ?? { success: true }),
  };
  const svc = new NumeroNegocioService(prisma as never, evolution as never);
  const takiy = jest.fn(async () =>
    o.takiyOk === false
      ? { success: false, error: 'Takiy: desvinculado' }
      : { success: true },
  );
  svc.enviarTakiyImpl = takiy as never;
  return { svc, evolution, takiy };
}

const MSG = { numero: '987654321', mensaje: 'Tu pedido va en camino' };

describe('orden de proveedores del número del negocio', () => {
  it('Evolution conectado va primero y Takiy no se toca', async () => {
    const { svc, takiy, evolution } = armar({
      evolutionConectado: true,
      takiy: true,
    });
    expect(await svc.enviar(1, MSG)).toEqual({
      success: true,
      via: 'EVOLUTION',
    });
    expect(evolution.enviar).toHaveBeenCalledWith(1, MSG);
    expect(takiy).not.toHaveBeenCalled();
    expect(await svc.proveedorActivo(1)).toBe('EVOLUTION');
  });

  it('Evolution no conectado (o fuera del piloto) → Takiy activo', async () => {
    const { svc, takiy, evolution } = armar({
      evolutionConectado: false,
      takiy: true,
    });
    expect(
      await svc.enviar(1, { ...MSG, archivoUrl: 'https://s3/a.pdf' }),
    ).toEqual({ success: true, via: 'TAKIY' });
    expect(evolution.enviar).not.toHaveBeenCalled();
    expect(takiy).toHaveBeenCalledWith(
      { appKey: 'app', authKey: 'auth' },
      {
        numero: '987654321',
        mensaje: MSG.mensaje,
        archivoUrl: 'https://s3/a.pdf',
      },
    );
    expect(await svc.proveedorActivo(1)).toBe('TAKIY');
  });

  it.each(['TOPE_DIARIO', 'COLA_LLENA', 'NO_CONECTADO', 'ENVIO'])(
    'Evolution falla claro (%s) → cae a Takiy',
    async (motivo) => {
      const { svc, takiy } = armar({
        evolutionConectado: true,
        evolution: { success: false, motivo, error: 'x' },
        takiy: true,
      });
      expect(await svc.enviar(1, MSG)).toEqual({ success: true, via: 'TAKIY' });
      expect(takiy).toHaveBeenCalledTimes(1);
    },
  );

  it('Evolution con timeout (pudo salir) → NO se repite por Takiy', async () => {
    const { svc, takiy } = armar({
      evolutionConectado: true,
      evolution: {
        success: false,
        motivo: 'ENVIO',
        ambiguo: true,
        error: 'tardó',
      },
      takiy: true,
    });
    expect(await svc.enviar(1, MSG)).toEqual({
      success: false,
      via: 'EVOLUTION',
      error: 'tardó',
    });
    expect(takiy).not.toHaveBeenCalled();
  });

  it('Evolution falla y no hay Takiy → falla con via EVOLUTION (el llamador sigue con Meta)', async () => {
    const { svc } = armar({
      evolutionConectado: true,
      evolution: { success: false, motivo: 'TOPE_DIARIO', error: 'tope' },
    });
    expect(await svc.enviar(1, MSG)).toEqual({
      success: false,
      via: 'EVOLUTION',
      error: 'tope',
    });
  });

  it('ninguno → via null, sin llamadas', async () => {
    const { svc, takiy, evolution } = armar({ evolutionConectado: false });
    const r = await svc.enviar(1, MSG);
    expect(r).toMatchObject({ success: false, via: null });
    expect(takiy).not.toHaveBeenCalled();
    expect(evolution.enviar).not.toHaveBeenCalled();
    expect(await svc.disponible(1)).toBe(false);
  });

  it('Takiy falla → error de Takiy', async () => {
    const { svc } = armar({
      evolutionConectado: false,
      takiy: true,
      takiyOk: false,
    });
    expect(await svc.enviar(1, MSG)).toEqual({
      success: false,
      via: 'TAKIY',
      error: 'Takiy: desvinculado',
    });
  });

  it('consejo según la vía', () => {
    expect(consejoNumeroNegocio('TAKIY')).toMatch(/Takiy/);
    expect(consejoNumeroNegocio('EVOLUTION')).toMatch(/WhatsApp/);
  });
});

describe('aviso al cliente (despacho) por el número del negocio', () => {
  function servicio(via: 'EVOLUTION' | 'TAKIY' | null) {
    const numeroNegocio = {
      proveedorActivo: jest.fn(async () => via),
      enviar: jest.fn(async () => ({ success: true, via })),
    };
    const s = new WhatsAppService(
      {} as never,
      { get: () => undefined } as never,
      numeroNegocio as never,
    );
    const plantilla = jest
      .spyOn(s, 'enviarPlantilla')
      .mockResolvedValue({ success: true } as never);
    return { s, numeroNegocio, plantilla };
  }

  it('con Evolution conectado sale como texto (el propio del negocio) y no gasta plantilla de Meta', async () => {
    const { s, numeroNegocio, plantilla } = servicio('EVOLUTION');
    const r = await s.enviarAvisoCliente(
      1,
      '987654321',
      'pedido_en_camino',
      ['Ana', 'B001-1', 'Luis'],
      'Hola Ana, ya va',
    );
    expect(r).toMatchObject({
      success: true,
      via: 'EVOLUTION',
      texto: 'Hola Ana, ya va',
    });
    expect(numeroNegocio.enviar).toHaveBeenCalledWith(1, {
      numero: '987654321',
      mensaje: 'Hola Ana, ya va',
      archivoUrl: undefined,
    });
    expect(plantilla).not.toHaveBeenCalled();
  });

  it('sin número por QR → plantilla de Meta como siempre', async () => {
    const { s, numeroNegocio, plantilla } = servicio(null);
    const r = await s.enviarAvisoCliente(
      1,
      '987654321',
      'pedido_en_camino',
      ['Ana', 'B001-1', 'Luis'],
      'propio',
    );
    expect(r.via).toBe('META');
    expect(numeroNegocio.enviar).not.toHaveBeenCalled();
    expect(plantilla).toHaveBeenCalled();
  });

  it('sin el servicio inyectado (pruebas viejas) → Meta', async () => {
    const s = new WhatsAppService(
      {} as never,
      { get: () => undefined } as never,
    );
    expect(await s.numeroNegocioActivo(1)).toBeNull();
    expect(await s.enviarDesdeNumeroNegocio(1, '987654321', 'x')).toMatchObject(
      { success: false, via: null },
    );
  });
});
