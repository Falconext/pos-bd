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

function armar() {
  const prisma = {
    usuario: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    plan: { findUnique: jest.fn().mockResolvedValue({ id: 900 }) },
    notificacion: { createMany: jest.fn() },
  };
  const service = new EmpresaService(prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  const crear = jest
    .spyOn(service, 'crear')
    .mockResolvedValue({ id: 5, usuarios: [{ id: 11 }] } as any);
  jest.spyOn(service, 'registrarLog').mockResolvedValue(undefined as any);
  return { prisma, service, crear };
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

  it('no deja registrar un correo que ya tiene cuenta', async () => {
    const { prisma, service, crear } = armar();
    prisma.usuario.findUnique.mockResolvedValue({ id: 1 });
    await expect(service.registrarPrueba(await validar(base))).rejects.toBeInstanceOf(ForbiddenException);
    expect(crear).not.toHaveBeenCalled();
  });
});
