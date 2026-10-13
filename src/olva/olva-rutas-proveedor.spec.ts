import { OlvaApiService } from './olva-api.service';

/**
 * Las rutas del proveedor Olva.
 *
 * Olva renombró endpoints y nuestras llamadas quedaron devolviendo 404 "Ruta no
 * encontrada". El rastreo automático estuvo un mes fallando en silencio: los
 * envíos avanzaban en Olva y el panel seguía diciendo "Preparando", sin que
 * nadie se enterara porque el cron solo lo anotaba en su log.
 *
 * Por eso estos tests fijan la RUTA y la FORMA del cuerpo: es lo único que
 * cambió y lo único que no se nota hasta que un cliente reclama.
 */
describe('Rutas del proveedor Olva', () => {
  const montar = (respuesta: any = { success: true, data: {} }) => {
    const api = new OlvaApiService();
    const pedido = jest.fn().mockResolvedValue({ json: async () => respuesta });
    (api as any).requestConReintento = pedido;
    return { api, pedido };
  };

  const llamada = (pedido: jest.Mock) => ({
    metodo: pedido.mock.calls[0][0],
    ruta: pedido.mock.calls[0][1],
    body: pedido.mock.calls[0][2]?.body,
  });

  describe('rastreo de una guía', () => {
    it('va a POST /track, no al viejo GET /tracking/{nro}', async () => {
      const { api, pedido } = montar();
      await api.track('2741554', { year: '26' });

      const { metodo, ruta } = llamada(pedido);
      expect({ metodo, ruta }).toEqual({ metodo: 'POST', ruta: '/track' });
    });

    it('manda el sufijo de la guía como orderCode', async () => {
      // "2741554-26" se parte en 2741554 + 26; sin el código Olva no la ubica.
      const { api, pedido } = montar();
      await api.track('2741554', { year: '26' });

      expect(llamada(pedido).body).toEqual({
        orderNumber: '2741554',
        orderCode: '26',
      });
    });

    it('una guía sin sufijo viaja sin orderCode', async () => {
      const { api, pedido } = montar();
      await api.track('2741554');

      expect(llamada(pedido).body).toEqual({ orderNumber: '2741554' });
    });
  });

  describe('rastreo en lote', () => {
    it('va a POST /track/batch y parte cada guía', async () => {
      const { api, pedido } = montar({ success: true, data: [] });
      await api.trackBulk(['2741554-26', '9999999-25']);

      const { metodo, ruta, body } = llamada(pedido);
      expect({ metodo, ruta }).toEqual({ metodo: 'POST', ruta: '/track/batch' });
      expect(body).toEqual({
        shipments: [
          { orderNumber: '2741554', orderCode: '26' },
          { orderNumber: '9999999', orderCode: '25' },
        ],
      });
    });

    it('respeta el tope de 50 del proveedor', async () => {
      const { api, pedido } = montar({ success: true, data: [] });
      await api.trackBulk(Array.from({ length: 70 }, (_, i) => `${i}-26`));

      expect(llamada(pedido).body.shipments).toHaveLength(50);
    });

    it('sin guías no molesta al proveedor', async () => {
      const { api, pedido } = montar();
      await expect(api.trackBulk([])).resolves.toEqual([]);
      expect(pedido).not.toHaveBeenCalled();
    });
  });

  describe('cotización', () => {
    it('va a POST /quotes con los nombres del proveedor', async () => {
      const { api, pedido } = montar();
      await api.cotizar({
        ubigeo_code_origin: '150101',
        ubigeo_code_destiny: '040101',
        delivery_type: 'O',
        shipment_type: 1,
        weight: 1.5,
        partner_rate: true,
      });

      const { metodo, ruta, body } = llamada(pedido);
      expect({ metodo, ruta }).toEqual({ metodo: 'POST', ruta: '/quotes' });
      // El proveedor dejó de aceptar `ubigeo_code_*`: ahora son origin/destination.
      expect(body).toEqual({
        origin: '150101',
        destination: '040101',
        delivery_type: 'O',
        shipment_type: 1,
        weight: 1.5,
        partner_rate: true,
      });
    });
  });
});
