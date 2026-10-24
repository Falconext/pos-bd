import { llegadaAAgencia, quienReparte, saldoParaRetirar, textoDePlantilla, tocaRecordatorioRecojo, ultimos9 } from './recojo-agencia';

const h = (iso: string) => new Date(iso);

describe('recordatorio de recojo en agencia', () => {
  const base = {
    llegadaEn: h('2026-10-20T15:00:00Z'), // 10:00 Lima
    enviados: 0,
    ultimoEn: null,
    maxDias: 3,
    ultimoMensajeClienteEn: null,
    ahora: h('2026-10-21T15:30:00Z'),
  };

  it('al día siguiente de llegar, toca', () => {
    expect(tocaRecordatorioRecojo(base)).toEqual({ toca: true, motivo: 'ok' });
  });

  it('llegó en la tarde: al otro día a media mañana ya toca (aunque no pasaron 24 h)', () => {
    expect(
      tocaRecordatorioRecojo({ ...base, llegadaEn: h('2026-10-20T23:00:00Z'), ahora: h('2026-10-21T15:30:00Z') }).toca,
    ).toBe(true);
  });

  it('el mismo día que llegó no (ya recibió el aviso de llegada)', () => {
    expect(tocaRecordatorioRecojo({ ...base, ahora: h('2026-10-21T02:00:00Z') }).motivo).toBe('recien-llego');
  });

  it('apagado, o ya llegó al tope de días', () => {
    expect(tocaRecordatorioRecojo({ ...base, maxDias: 0 }).motivo).toBe('apagado');
    expect(tocaRecordatorioRecojo({ ...base, enviados: 3 }).motivo).toBe('tope');
  });

  it('uno por día de Lima', () => {
    // último a las 10:30 Lima del 21; ahora 23:00 Lima del 21 (04:00Z del 22)
    expect(
      tocaRecordatorioRecojo({ ...base, enviados: 1, ultimoEn: h('2026-10-21T15:30:00Z'), ahora: h('2026-10-22T04:00:00Z') }).motivo,
    ).toBe('ya-hoy');
    expect(
      tocaRecordatorioRecojo({ ...base, enviados: 1, ultimoEn: h('2026-10-21T15:30:00Z'), ahora: h('2026-10-22T15:30:00Z') }).toca,
    ).toBe(true);
  });

  it('si el cliente respondió después del último aviso, se corta', () => {
    expect(
      tocaRecordatorioRecojo({ ...base, ultimoMensajeClienteEn: h('2026-10-20T18:00:00Z') }).motivo,
    ).toBe('cliente-respondio');
    // Lo que escribió ANTES de que llegara no cuenta.
    expect(tocaRecordatorioRecojo({ ...base, ultimoMensajeClienteEn: h('2026-10-19T18:00:00Z') }).toca).toBe(true);
  });

  it('llegada = la última vez que pasó a EN_AGENCIA', () => {
    const respaldo = h('2026-10-01T00:00:00Z');
    expect(
      llegadaAAgencia(
        [
          { estado: 'EN_CAMINO', fecha: '2026-10-18T10:00:00Z' },
          { estado: 'EN_AGENCIA', fecha: '2026-10-19T10:00:00Z' },
          { estado: 'EN_AGENCIA', fecha: '2026-10-20T10:00:00Z' },
        ],
        respaldo,
      ).toISOString(),
    ).toBe('2026-10-20T10:00:00.000Z');
    expect(llegadaAAgencia(null, respaldo)).toBe(respaldo);
  });

  it('saldo: manda el del comprobante; si no, el contra entrega', () => {
    expect(saldoParaRetirar(45.5, 80)).toBe(45.5);
    expect(saldoParaRetirar(0, 80)).toBe(80);
    expect(saldoParaRetirar(null, null)).toBe(0);
  });

  it('celular y texto de plantilla', () => {
    expect(ultimos9('+51 991 065 217')).toBe('991065217');
    expect(ultimos9('51991065217')).toBe('991065217');
    expect(ultimos9('123')).toBeNull();
    expect(textoDePlantilla('Hola {{1}}, tu pedido {{2}}.', ['Ana', 'NV01-5'])).toBe('Hola Ana, tu pedido NV01-5.');
  });
});

describe('quién reparte (aviso en camino)', () => {
  it('nombre y celular', () => {
    expect(quienReparte({ nombre: 'Tony Cayo', celular: '+51 955947892' })).toBe('Tony Cayo (cel. 955 947 892)');
    expect(quienReparte({ nombre: 'Tony Cayo', celular: null })).toBe('Tony Cayo');
    expect(quienReparte(null)).toBeNull();
  });
});
