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
 *  - descargar SIN `numTicket` y `codProceso` → el mismo 422, aunque el nombre
 *    del archivo esté bien (verificado el 2026-09-27). Ese mensaje hace pensar
 *    en un nombre mal armado y tuvo la descarga trabada varios días; agregar
 *    `codLibro`, que parece lo natural, tampoco alcanza.
 *
 * Estas pruebas congelan esos aprendizajes para que no se pierdan.
 */
import axios from 'axios';
import AdmZip from 'adm-zip';
import { SireClient, extraerTxtDelZip } from './sire.client';

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
    /** Un ZIP como el que manda SUNAT: un único TXT adentro. */
    const zipConTxt = (contenido: string, nombre = 'propuesta.txt') => {
      const zip = new AdmZip();
      zip.addFile(nombre, Buffer.from(contenido, 'utf8'));
      return zip.toBuffer();
    };

    const descargar = (extra: Record<string, string> = {}) =>
      cliente().descargarArchivo({
        nombreArchivo: '20616318773-propuesta.zip',
        numTicket: '20260300000014',
        codProceso: '10',
        perTributario: '202608',
        ...extra,
      });

    /** Parámetros del último GET (ahora viajan como `params`, no en la URL). */
    const paramsPedidos = () => (axiosMock.get.mock.calls[0][1] as any).params;

    beforeEach(() => {
      axiosMock.get.mockResolvedValue({ data: zipConTxt('RUC|Razón social\n') });
    });

    it('manda numTicket y codProceso: sin ellos SUNAT responde 422', async () => {
      await descargar();
      const p = paramsPedidos();
      expect(p.numTicket).toBe('20260300000014');
      expect(p.codProceso).toBe('10');
      expect(p.perTributario).toBe('202608');
      expect(p.nomArchivoReporte).toBe('20616318773-propuesta.zip');
    });

    it('usa el tipo que informa el ticket', async () => {
      await descargar({ codTipoArchivo: '00' });
      expect(paramsPedidos().codTipoAchivoReporte).toBe('00');
    });

    it('si el ticket no lo informa, asume 00 (no 01, que no existe)', async () => {
      await descargar();
      expect(paramsPedidos().codTipoAchivoReporte).toBe('00');
    });

    it('pide el archivo como binario: lo que llega es un ZIP, no texto', async () => {
      await descargar();
      expect((axiosMock.get.mock.calls[0][1] as any).responseType).toBe('arraybuffer');
    });

    it('devuelve el TXT de adentro del ZIP, no el ZIP', async () => {
      axiosMock.get.mockResolvedValue({
        data: zipConTxt('RUC|Razón social|Periodo\n20616318773|KREZKA|202608\n'),
      });
      const contenido = await descargar();
      expect(contenido).toContain('20616318773|KREZKA|202608');
      expect(contenido.startsWith('PK')).toBe(false);
    });
  });
});

describe('El ZIP que manda SUNAT', () => {
  const armar = (archivos: Array<[string, string]>) => {
    const zip = new AdmZip();
    archivos.forEach(([n, c]) => zip.addFile(n, Buffer.from(c, 'utf8')));
    return zip.toBuffer();
  };

  it('saca el TXT cuando es el único archivo', () => {
    expect(extraerTxtDelZip(armar([['propuesta.txt', 'contenido']]))).toBe('contenido');
  });

  it('con varios archivos se queda con el .txt', () => {
    const zip = armar([
      ['resumen.pdf', 'no es este'],
      ['propuesta.txt', 'este sí'],
    ]);
    expect(extraerTxtDelZip(zip)).toBe('este sí');
  });

  it('conserva las tildes del castellano', () => {
    // El TXT trae razones sociales con ñ y tildes; leerlo como latin1 las
    // rompería y el cruce dejaría de encontrar proveedores.
    const zip = armar([['propuesta.txt', 'KREZKA PERÚ S.A.C.|Año|Ñandú']]);
    expect(extraerTxtDelZip(zip)).toBe('KREZKA PERÚ S.A.C.|Año|Ñandú');
  });

  it('un ZIP vacío avisa en vez de devolver texto en blanco', () => {
    expect(() => extraerTxtDelZip(armar([]))).toThrow(/vacío/i);
  });
});
