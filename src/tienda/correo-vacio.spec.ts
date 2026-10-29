/**
 * 29-10: el correo es opcional en la tienda, pero el checkout lo manda como
 * "" y el pedido se rechazaba ("clienteEmail must be an email").
 */
import { ValidationPipe } from '@nestjs/common';
import { CrearPedidoDto } from './dto/crear-pedido.dto';

const pipe = new ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } });
const validar = (body: any) => pipe.transform(body, { type: 'body', metatype: CrearPedidoDto });
const BASE = { clienteNombre: 'Rosa', clienteTelefono: '999888777', medioPago: 'EFECTIVO', items: [{ productoId: 1, cantidad: 1 }] };

describe('correo vacío en el pedido de la tienda', () => {
  it('"" en clienteEmail y culqiEmail cuenta como sin correo', async () => {
    const dto = await validar({ ...BASE, clienteEmail: '', culqiEmail: '  ' });
    expect(dto.clienteEmail).toBeUndefined();
    expect(dto.culqiEmail).toBeUndefined();
  });

  it('un correo mal escrito se sigue rechazando', async () => {
    await expect(validar({ ...BASE, clienteEmail: 'rosa@' })).rejects.toBeTruthy();
  });
});
