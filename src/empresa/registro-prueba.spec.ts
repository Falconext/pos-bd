import 'reflect-metadata';
import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { EmpresaService } from './empresa.service';
import { RegistroPruebaDto } from './dto/registro-prueba.dto';

/**
 * El autoregistro es público: lo sensible lo decide el servidor. Antes este
 * endpoint recibía el formulario completo del admin y cualquiera podía
 * mandarse un planId pagado y un vencimiento en 2099.
 */
const base = {
  nombreNegocio: 'Ferretería Lucho',
  ruc: '20123456789',
  nombre: 'Luis Pérez',
  email: 'Luis@Correo.pe ',
  celular: '987 654 321',
  password: 'secreta123',
  plan: 'scale',
  brand: 'krezka',
};

const pipe = new ValidationPipe({ whitelist: true, transform: true });
const validar = (body: object) =>
  pipe.transform(body, { type: 'body', metatype: RegistroPruebaDto }) as Promise<RegistroPruebaDto>;

const SUNAT = {
  nombre_o_razon_social: 'FERRETERIA LUCHO S.A.C.',
  estado: 'ACTIVO',
  direccion_completa: 'AV. LOS OLIVOS 123',
  departamento: 'LIMA',
  provincia: 'LIMA',
  distrito: 'LOS OLIVOS',
  ubigeo: ['15', '1501', '150117'],
};

function armar() {
  const prisma = {
    usuario: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    empresa: {
      // Por RUC: no hay otra cuenta. Por id: la empresa recién creada, que lee vincularPse.
      findUnique: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(where.id ? { id: 5, ruc: '20123456789', usaDemo: true, tipoEmpresa: 'FORMAL', billingProvider: 'QPSE' } : null),
      ),
      update: jest.fn(),
    },
    plan: { findUnique: jest.fn().mockResolvedValue({ id: 900 }) },
    notificacion: { createMany: jest.fn() },
  };
  const qpse = {
    cuentaEmpresas: jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ ruc: '20123456789', environment: 'demo', username: 'u20123456789', password: 'clave', external_id: 'x' }]),
    cuentaCrearEmpresa: jest.fn().mockResolvedValue({}),
  };
  const service = new EmpresaService(prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any, qpse as any);
  const crear = jest
    .spyOn(service, 'crear')
    .mockResolvedValue({ id: 5, usuarios: [{ id: 11 }] } as any);
  const consultarRuc = jest.spyOn(service, 'consultarRuc').mockResolvedValue(SUNAT);
  const registrarLog = jest.spyOn(service, 'registrarLog').mockResolvedValue(undefined as any);
  return { prisma, qpse, service, crear, consultarRuc, registrarLog };
}

describe('autoregistro de prueba de IA de Ventas', () => {
  it('descarta plan, vencimiento y credenciales que vengan en el cuerpo', async () => {
    const dto = await validar({
      ...base,
      planId: 1,
      fechaExpiracion: '31/12/2099',
      billingApiToken: 'x',
      whatsappApiToken: 'y',
      usaDemo: false,
    });
    expect(dto).not.toHaveProperty('planId');
    expect(dto).not.toHaveProperty('fechaExpiracion');
    expect(dto).not.toHaveProperty('billingApiToken');
    expect(dto).not.toHaveProperty('usaDemo');
    expect(dto.email).toBe('luis@correo.pe');
    expect(dto.celular).toBe('987654321');
  });

  it('rechaza RUC y celular con formato inválido', async () => {
    await expect(validar({ ...base, ruc: '123' })).rejects.toBeTruthy();
    await expect(validar({ ...base, celular: '12345' })).rejects.toBeTruthy();
    await expect(validar({ ...base, plan: 'full' })).rejects.toBeTruthy();
  });

  it('crea la empresa en el plan de prueba, con vencimiento a 7 días y facturación en demo', async () => {
    const { prisma, service, crear } = armar();
    const dto = await validar(base);

    await service.registrarPrueba(dto);

    expect(prisma.plan.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { nombre_plataforma_producto: { nombre: 'Prueba Ventas', plataforma: 'krezka', producto: 'ventas' } },
      }),
    );
    const enviado = crear.mock.calls[0][0] as any;
    expect(enviado.planId).toBe(900);
    expect(enviado.usaDemo).toBe(true);
    expect(enviado.producto).toBe('ventas');
    const [dd, mm, yyyy] = enviado.fechaExpiracion.split('/').map(Number);
    const dias = Math.round((new Date(yyyy, mm - 1, dd).getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
    expect(dias).toBe(7);
  });

  it('avisa al equipo de la marca y a los admins sin marca asignada', async () => {
    const { prisma, service } = armar();
    prisma.usuario.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    await service.registrarPrueba(await validar(base));

    expect(prisma.usuario.findMany.mock.calls[0][0].where.OR).toEqual([
      { sistemaNegocio: 'krezka' },
      { sistemaNegocio: null },
    ]);
    const avisos = prisma.notificacion.createMany.mock.calls[0][0].data;
    expect(avisos).toHaveLength(2);
    expect(avisos[0].mensaje).toContain('Ventas Scale');
  });

  it('no deja registrar un correo que ya tiene cuenta', async () => {
    const { prisma, service, crear } = armar();
    prisma.usuario.findUnique.mockResolvedValue({ id: 1 });
    await expect(service.registrarPrueba(await validar(base))).rejects.toBeInstanceOf(ForbiddenException);
    expect(crear).not.toHaveBeenCalled();
  });

  it('no deja registrar un RUC que ya tiene cuenta', async () => {
    const { prisma, service, crear } = armar();
    prisma.empresa.findUnique.mockImplementation(() => Promise.resolve({ id: 3 }));
    await expect(service.registrarPrueba(await validar(base))).rejects.toBeInstanceOf(ForbiddenException);
    expect(crear).not.toHaveBeenCalled();
  });

  it('rechaza un RUC que SUNAT no tiene o que no está activo', async () => {
    const { service, crear, consultarRuc } = armar();
    consultarRuc.mockResolvedValueOnce(undefined);
    await expect(service.registrarPrueba(await validar(base))).rejects.toThrow('No encontramos ese RUC');
    consultarRuc.mockResolvedValueOnce({ ...SUNAT, estado: 'BAJA DE OFICIO' });
    await expect(service.registrarPrueba(await validar(base))).rejects.toThrow('BAJA DE OFICIO');
    expect(crear).not.toHaveBeenCalled();
  });

  it('usa la razón social y la dirección de SUNAT para los comprobantes', async () => {
    const { service, crear } = armar();
    await service.registrarPrueba(await validar(base));
    const enviado = crear.mock.calls[0][0] as any;
    expect(enviado.razonSocial).toBe('FERRETERIA LUCHO S.A.C.');
    expect(enviado.nombreComercial).toBe('Ferretería Lucho');
    expect(enviado.direccion).toBe('AV. LOS OLIVOS 123');
    expect(enviado.ubigeo).toBe('150117');
  });

  it('registra el RUC en QPSE demo y guarda las credenciales de firma', async () => {
    const { prisma, qpse, service, registrarLog } = armar();
    await service.registrarPrueba(await validar(base));
    expect(qpse.cuentaCrearEmpresa).toHaveBeenCalledWith('20123456789');
    expect(prisma.empresa.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { usuarioPse: 'u20123456789', contrasenaPse: 'clave' },
    });
    expect(registrarLog.mock.calls.map((c) => c[1])).toContain('QPSE_DEMO_ACTIVADO');
  });

  it('si QPSE falla, la cuenta se crea igual y el equipo recibe el motivo', async () => {
    const { prisma, qpse, service, registrarLog } = armar();
    prisma.usuario.findMany.mockResolvedValue([{ id: 1 }]);
    qpse.cuentaEmpresas.mockReset().mockResolvedValue([]);
    qpse.cuentaCrearEmpresa.mockRejectedValue(new Error('QPSE: El RUC ya está registrado en otra cuenta'));

    await expect(service.registrarPrueba(await validar(base))).resolves.toEqual({ empresaId: 5, email: 'luis@correo.pe' });
    expect(prisma.empresa.update).not.toHaveBeenCalled();
    expect(registrarLog.mock.calls.map((c) => c[1])).toContain('QPSE_DEMO_PENDIENTE');
    expect(prisma.notificacion.createMany.mock.calls[0][0].data[0].mensaje).toContain('otro proveedor');
  });

  it('no toca un RUC que ya está en producción en QPSE', async () => {
    const { prisma, qpse, service } = armar();
    qpse.cuentaEmpresas.mockReset().mockResolvedValue([{ ruc: '20123456789', environment: 'production', username: 'u', password: 'p', external_id: 'x' }]);
    await service.registrarPrueba(await validar(base));
    expect(qpse.cuentaCrearEmpresa).not.toHaveBeenCalled();
    expect(prisma.empresa.update).not.toHaveBeenCalled();
  });

  it('si la consulta de RUC no responde, registra igual y deja la facturación para el equipo', async () => {
    const { qpse, service, crear, consultarRuc } = armar();
    consultarRuc.mockRejectedValueOnce(new Error('timeout'));
    await service.registrarPrueba(await validar(base));
    expect((crear.mock.calls[0][0] as any).razonSocial).toBe('Ferretería Lucho');
    expect(qpse.cuentaCrearEmpresa).not.toHaveBeenCalled();
  });
});
