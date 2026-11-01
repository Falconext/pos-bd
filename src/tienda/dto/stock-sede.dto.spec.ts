/** Contrato de entrada del stock por sede, con el ValidationPipe real de main.ts. */
import { ValidationPipe } from '@nestjs/common';
import { ConfigurarTiendaDto } from './configurar-tienda.dto';
import { CrearPedidoDto } from './crear-pedido.dto';
import { DisponibilidadCarritoDto } from './disponibilidad-carrito.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const run = (metatype: any, body: unknown) =>
  pipe.transform(body, { type: 'body', metatype });

describe('DTOs de stock por sede', () => {
  it('config: null = la principal, [] = todas; ids en texto se convierten', async () => {
    await expect(
      run(ConfigurarTiendaDto, {
        tiendaSedeId: null,
        tiendaSedesIds: [],
        tiendaStockModo: 'CLIENTE',
      }),
    ).resolves.toEqual({
      tiendaSedeId: null,
      tiendaSedesIds: [],
      tiendaStockModo: 'CLIENTE',
    });
    await expect(
      run(ConfigurarTiendaDto, { tiendaSedeId: '3', tiendaSedesIds: ['1', 2] }),
    ).resolves.toEqual({
      tiendaSedeId: 3,
      tiendaSedesIds: [1, 2],
    });
  });

  it('config: modo desconocido o ids inválidos → 400', async () => {
    await expect(
      run(ConfigurarTiendaDto, { tiendaStockModo: 'X' }),
    ).rejects.toBeTruthy();
    await expect(
      run(ConfigurarTiendaDto, { tiendaSedesIds: [0] }),
    ).rejects.toBeTruthy();
    await expect(
      run(ConfigurarTiendaDto, { tiendaSedeId: 'abc' }),
    ).rejects.toBeTruthy();
  });

  it('pedido: sedeId opcional y numérico', async () => {
    const base = {
      clienteNombre: 'Ana',
      clienteTelefono: '999888777',
      medioPago: 'EFECTIVO',
      items: [{ productoId: 1, cantidad: 1 }],
    };
    await expect(
      run(CrearPedidoDto, { ...base, sedeId: '2' }),
    ).resolves.toMatchObject({ sedeId: 2 });
    await expect(
      run(CrearPedidoDto, { ...base, sedeId: 0 }),
    ).rejects.toBeTruthy();
  });

  it('disponibilidad: al menos un ítem con cantidad ≥ 1', async () => {
    await expect(
      run(DisponibilidadCarritoDto, {
        sedeId: '2',
        items: [{ productoId: '1', cantidad: '2' }],
      }),
    ).resolves.toEqual({ sedeId: 2, items: [{ productoId: 1, cantidad: 2 }] });
    await expect(
      run(DisponibilidadCarritoDto, { items: [] }),
    ).rejects.toBeTruthy();
    await expect(
      run(DisponibilidadCarritoDto, {
        items: [{ productoId: 1, cantidad: 0 }],
      }),
    ).rejects.toBeTruthy();
  });
});
