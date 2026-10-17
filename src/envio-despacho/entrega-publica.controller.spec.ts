/**
 * QA del enlace del repartidor, contra el controlador de verdad.
 *
 * No alcanza con probar las funciones sueltas: lo que hay que defender acá es
 * el CONTRATO HTTP, porque esta es la única ruta del sistema que atiende sin
 * credenciales. Tres cosas se verifican y las tres son de seguridad:
 *
 *  1. Que entre sin token de sesión (si pidiera login, el enlace no sirve).
 *  2. Que un token inválido y uno vencido respondan IGUAL, para que nadie
 *     pueda sondear qué tokens existieron.
 *  3. Que devuelva lo mínimo para entregar y nada más: el enlace no pide
 *     contraseña y va a andar suelto en los WhatsApp de varios motorizados.
 */
import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { EntregaPublicaController } from './entrega-publica.controller';
import { EnvioDespachoService } from './envio-despacho.service';
import { EvidenciaEntregaService } from './evidencia-entrega.service';

const TOKEN = 'tok3n-de-prueba';

const ENTREGA = {
  pedido: 'NV01-00000009',
  estado: 'PREPARANDO',
  entregadoEn: null,
  tipoEnvio: 'DOMICILIO',
  destinatario: 'Diego Ortega',
  telefono: '991065217',
  direccion: 'Mz N Lt 13',
  distrito: 'San Juan de Lurigancho',
  referencia: 'Una ferretería',
  paquetes: 1,
  aCobrar: 45,
  repartidor: 'Luis',
  items: [{ cantidad: 1, descripcion: 'Ulceras gastritis' }],
};

describe('GET/PATCH/POST /entrega/:token', () => {
  let app: INestApplication;
  const despacho = {
    entregaPorToken: jest.fn(),
    marcarPorToken: jest.fn(),
    comprobanteDeToken: jest.fn(),
  };
  const evidencias = { registrar: jest.fn() };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [EntregaPublicaController],
      providers: [
        { provide: EnvioDespachoService, useValue: despacho },
        { provide: EvidenciaEntregaService, useValue: evidencias },
      ],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe('ver la entrega', () => {
    it('abre SIN token de sesión: el enlace es la credencial', async () => {
      // Si esto pidiera login, el repartidor no podría usarlo y volveríamos
      // al problema original: darle usuario con acceso al módulo de Ventas.
      despacho.entregaPorToken.mockResolvedValue(ENTREGA);

      const res = await request(app.getHttpServer()).get(`/entrega/${TOKEN}`);

      expect(res.status).toBe(200);
      expect(res.body.pedido).toBe('NV01-00000009');
    });

    it('trae lo que hace falta para entregar', async () => {
      despacho.entregaPorToken.mockResolvedValue(ENTREGA);

      const { body } = await request(app.getHttpServer()).get(
        `/entrega/${TOKEN}`,
      );

      expect(body.destinatario).toBe('Diego Ortega');
      expect(body.direccion).toBe('Mz N Lt 13');
      expect(body.telefono).toBe('991065217');
      expect(body.aCobrar).toBe(45);
      expect(body.items).toHaveLength(1);
    });

    it('NO filtra nada de la venta', async () => {
      // El enlace anda suelto: no puede llevar precios unitarios, márgenes,
      // costos ni el id interno del despacho.
      despacho.entregaPorToken.mockResolvedValue(ENTREGA);

      const { body } = await request(app.getHttpServer()).get(
        `/entrega/${TOKEN}`,
      );

      const texto = JSON.stringify(body);
      for (const prohibido of [
        'precioUnitario',
        'costoPromedio',
        'mtoImpVenta',
        'empresaId',
        'clienteId',
        'accesoToken',
      ]) {
        expect(texto).not.toContain(prohibido);
      }
    });

    it('un token que no existe da 404', async () => {
      despacho.entregaPorToken.mockResolvedValue(null);

      const res = await request(app.getHttpServer()).get('/entrega/inventado');

      expect(res.status).toBe(404);
    });

    it('un enlace vencido da el MISMO 404 que uno inexistente', async () => {
      // Si se distinguieran, se podría sondear qué tokens existieron.
      despacho.entregaPorToken.mockResolvedValue(null);
      const vencido = await request(app.getHttpServer()).get('/entrega/vencido');
      const inexistente = await request(app.getHttpServer()).get('/entrega/xxx');

      expect(vencido.status).toBe(inexistente.status);
      expect(vencido.body.message).toBe(inexistente.body.message);
    });
  });

  describe('marcar el estado', () => {
    it('marca entregado', async () => {
      despacho.marcarPorToken.mockResolvedValue({ estado: 'ENTREGADO' });

      const res = await request(app.getHttpServer())
        .patch(`/entrega/${TOKEN}/estado`)
        .send({ estado: 'ENTREGADO' });

      expect(res.status).toBe(200);
      expect(despacho.marcarPorToken).toHaveBeenCalledWith(TOKEN, 'ENTREGADO');
    });

    it('acepta el estado en minúsculas', async () => {
      // Lo manda una pantalla hecha a mano; no hay por qué ser estricto.
      despacho.marcarPorToken.mockResolvedValue({ estado: 'EN_CAMINO' });

      await request(app.getHttpServer())
        .patch(`/entrega/${TOKEN}/estado`)
        .send({ estado: 'en_camino' });

      expect(despacho.marcarPorToken).toHaveBeenCalledWith(TOKEN, 'EN_CAMINO');
    });

    it('un enlace vencido no marca nada', async () => {
      despacho.marcarPorToken.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .patch(`/entrega/${TOKEN}/estado`)
        .send({ estado: 'ENTREGADO' });

      expect(res.status).toBe(404);
    });

    it('un estado que no le corresponde se rechaza', async () => {
      // El servicio lanza; acá se comprueba que el error llega como 400 y no
      // como un 500 que dejaría al repartidor sin saber qué pasó.
      despacho.marcarPorToken.mockRejectedValue(
        new (require('@nestjs/common').BadRequestException)(
          'Ese estado no se marca desde el enlace.',
        ),
      );

      const res = await request(app.getHttpServer())
        .patch(`/entrega/${TOKEN}/estado`)
        .send({ estado: 'DEVUELTO' });

      expect(res.status).toBe(400);
    });

    it('sin estado en el cuerpo no revienta', async () => {
      despacho.marcarPorToken.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .patch(`/entrega/${TOKEN}/estado`)
        .send({});

      expect(res.status).toBe(404);
      expect(despacho.marcarPorToken).toHaveBeenCalledWith(TOKEN, '');
    });
  });

  describe('la foto de la entrega', () => {
    it('la guarda contra el comprobante que resolvió el token', async () => {
      // El empresaId sale del token y NUNCA del request: si viniera de
      // afuera, el enlace de un negocio serviría para subirle fotos a otro.
      despacho.comprobanteDeToken.mockResolvedValue({
        comprobanteId: 500,
        empresaId: 89,
      });
      evidencias.registrar.mockResolvedValue({ ok: true });

      const res = await request(app.getHttpServer())
        .post(`/entrega/${TOKEN}/evidencias`)
        .attach('fotos', Buffer.from('fake-jpeg'), 'entrega.jpg');

      expect(res.status).toBe(201);
      const [comprobanteId, empresaId] = evidencias.registrar.mock.calls[0];
      expect(comprobanteId).toBe(500);
      expect(empresaId).toBe(89);
    });

    it('queda firmada como el repartidor, no como alguien de oficina', async () => {
      despacho.comprobanteDeToken.mockResolvedValue({
        comprobanteId: 500,
        empresaId: 89,
      });
      evidencias.registrar.mockResolvedValue({ ok: true });

      await request(app.getHttpServer())
        .post(`/entrega/${TOKEN}/evidencias`)
        .attach('fotos', Buffer.from('fake-jpeg'), 'entrega.jpg');

      const autor = evidencias.registrar.mock.calls[0][4];
      expect(autor.nombre).toMatch(/repartidor/i);
    });

    it('sin foto adjunta avisa, no revienta', async () => {
      despacho.comprobanteDeToken.mockResolvedValue({
        comprobanteId: 500,
        empresaId: 89,
      });

      const res = await request(app.getHttpServer()).post(
        `/entrega/${TOKEN}/evidencias`,
      );

      expect(res.status).toBe(400);
      expect(evidencias.registrar).not.toHaveBeenCalled();
    });

    it('un enlace vencido no sube fotos', async () => {
      despacho.comprobanteDeToken.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .post(`/entrega/${TOKEN}/evidencias`)
        .attach('fotos', Buffer.from('fake-jpeg'), 'entrega.jpg');

      expect(res.status).toBe(404);
      expect(evidencias.registrar).not.toHaveBeenCalled();
    });
  });
});
