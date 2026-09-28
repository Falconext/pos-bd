/**
 * Qué se le muestra al empresario cuando el SIRE falla.
 *
 * Visto en producción de Krezka: al pedir las compras de agosto salía
 * "El SIRE de SUNAT respondió con un error." y nada más. SUNAT sí manda el
 * motivo en el cuerpo de la respuesta, pero se descartaba y solo quedaba el
 * código HTTP — que no alcanza ni para decidir si vale la pena reintentar.
 */

/** La misma regla que usa sire.client.ts. */
const detalleDeSunat = (e: any, status?: number): string => {
  const cuerpo = e?.response?.data;
  const texto =
    typeof cuerpo === 'string'
      ? cuerpo
      : cuerpo
        ? (cuerpo.mensaje ?? cuerpo.message ?? cuerpo.errors ?? JSON.stringify(cuerpo))
        : null;
  const recorte =
    typeof texto === 'string' && texto.length > 400 ? `${texto.slice(0, 400)}…` : texto;
  return recorte ? `HTTP ${status ?? '?'} — ${recorte}` : `HTTP ${status ?? '?'}`;
};

describe('Detalle de un error del SIRE', () => {
  it('rescata el mensaje que manda SUNAT', () => {
    const e = { response: { data: { mensaje: "El campo 'codOrigenEnvio' es nulo o vacio" } } };
    expect(detalleDeSunat(e, 422)).toBe(
      "HTTP 422 — El campo 'codOrigenEnvio' es nulo o vacio",
    );
  });

  it('sirve igual si SUNAT usa "message" en vez de "mensaje"', () => {
    const e = { response: { data: { message: 'Periodo no disponible' } } };
    expect(detalleDeSunat(e, 422)).toBe('HTTP 422 — Periodo no disponible');
  });

  it('acepta un cuerpo de texto plano', () => {
    const e = { response: { data: 'Servicio no habilitado para el RUC' } };
    expect(detalleDeSunat(e, 403)).toBe('HTTP 403 — Servicio no habilitado para el RUC');
  });

  it('si el cuerpo es un objeto raro, lo muestra igual en vez de perderlo', () => {
    const e = { response: { data: { cod: '1033', otros: [1, 2] } } };
    expect(detalleDeSunat(e, 422)).toContain('1033');
  });

  it('recorta un cuerpo enorme para que entre en pantalla', () => {
    const e = { response: { data: 'x'.repeat(1000) } };
    const r = detalleDeSunat(e, 500);
    expect(r.length).toBeLessThan(450);
    expect(r.endsWith('…')).toBe(true);
  });

  it('sin cuerpo se queda con el código, como antes', () => {
    expect(detalleDeSunat({ response: {} }, 502)).toBe('HTTP 502');
    expect(detalleDeSunat({}, undefined)).toBe('HTTP ?');
  });
});
