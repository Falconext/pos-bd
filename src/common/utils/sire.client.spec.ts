/**
 * Lo que el SIRE real nos rechazó el 2026-09-25, comprobado contra la API de
 * SUNAT con las credenciales de KREZKA PERU:
 *
 *  - pedir la propuesta sin `codOrigenEnvio` → 422 "El campo 'codOrigenEnvio'
 *    es nulo o vacio"
 *  - consultar un ticket sin `page`/`perPage` → 422 "El campo 'page' no enviado"
 *  - descargar con el tipo de archivo fijo en "01" → 422 "El archivo solicitado
 *    no existe": los tickets reales traen "00" y el tipo hay que tomarlo del
 *    propio ticket.
 *
 * Estas pruebas congelan esos tres aprendizajes para que no se pierdan.
 */
import axios from 'axios';
import { SireClient } from './sire.client';

jest.mock('axios');
const axiosMock = axios as jest.Mocked<typeof axios>;

const cliente = () =>
  new SireClient({
    ruc: '20616318773',
    clientId: 'un-client-id',
    clientSecret: 'un-secret',
    usuarioSol: 'USUARIO',
    claveSol: 'clave',
  });

/** URL del último GET al recurso (el primer POST es el token). */
const urlPedida = () => String(axiosMock.get.mock.calls[0][0]);

beforeEach(() => {
  jest.clearAllMocks();
  (SireClient as any).cache?.clear?.();
  axiosMock.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 3600 } });
  axiosMock.get.mockResolvedValue({ data: {} });
});

describe('SIRE · parámetros que SUNAT exige', () => {
  it('la propuesta del RCE viaja con codOrigenEnvio=1 (servicio web)', async () => {
    await cliente().solicitarPropuestaRce('202608');
    expect(urlPedida()).toContain('codOrigenEnvio=1');
    expect(urlPedida()).toContain('/libros/rce/propuesta/web/propuesta/202608/');
  });

  it('la consulta de ticket viaja paginada', async () => {
    await cliente().consultarTicket('202608', '20260300000003');
    const url = urlPedida();
    expect(url).toContain('page=1');
    expect(url).toContain('perPage=20');
    expect(url).toContain('numTicket=20260300000003');
    expect(url).toContain('perIni=202608');
    expect(url).toContain('perFin=202608');
  });

  describe('descarga del archivo', () => {
    it('usa el tipo que informa el ticket', async () => {
      await cliente().descargarArchivo('20616318773-propuesta.zip', '00');
      expect(urlPedida()).toContain('codTipoAchivoReporte=00');
    });

    it('si el ticket no lo informa, asume 00 (no 01, que no existe)', async () => {
      await cliente().descargarArchivo('20616318773-propuesta.zip');
      expect(urlPedida()).toContain('codTipoAchivoReporte=00');
      expect(urlPedida()).not.toContain('codTipoAchivoReporte=01');
    });

    it('el nombre del archivo va escapado', async () => {
      await cliente().descargarArchivo('con espacio y+signo.zip', '00');
      expect(urlPedida()).toContain('con%20espacio%20y%2Bsigno.zip');
    });
  });
});
