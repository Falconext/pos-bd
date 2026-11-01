/**
 * Dobles de prueba para Evolution: una tabla WhatsappConexion en memoria con
 * la semántica de los UPDATE condicionales que usa el código (tope diario,
 * cambios de estado sin carreras) y un fetch falso que registra lo pedido.
 * Solo lo usan los .spec.
 */

export interface FilaFake {
  id: number;
  empresaId: number;
  instancia: string;
  tokenCifrado: string | null;
  estado: 'NO_CONECTADO' | 'CONECTANDO' | 'CONECTADO' | 'DESCONECTADO';
  numero: string | null;
  nombrePerfil: string | null;
  conectadoEn: Date | null;
  desconectadoEn: Date | null;
  avisoDesconexionEn: Date | null;
  enviadosHoy: number;
  enviadosDia: string | null;
  creadoEn: Date;
  actualizadoEn: Date;
}

function cumple(f: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]: [string, any]) => {
    if (k === 'OR') return (v as any[]).some((w) => cumple(f, w));
    if (k === 'NOT') return !cumple(f, v);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('not' in v) return f[k] !== v.not;
      if ('lt' in v) return f[k] < v.lt;
      if ('gt' in v) return f[k] > v.gt;
      if ('in' in v) return v.in.includes(f[k]);
      return true;
    }
    return f[k] === v;
  });
}

function aplicar(f: any, data: any) {
  for (const [k, v] of Object.entries(data) as [string, any][]) {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('increment' in v) f[k] += v.increment;
      else if ('decrement' in v) f[k] -= v.decrement;
    } else if (v !== undefined) f[k] = v;
  }
  f.actualizadoEn = new Date();
}

export function prismaFake(
  opts: {
    filas?: Partial<FilaFake>[];
    empresa?: Record<string, unknown>;
    usuarios?: {
      id: number;
      empresaId: number;
      rol: string;
      estado: string;
      celular: string;
      email: string;
    }[];
  } = {},
) {
  let seq = 0;
  const filas: FilaFake[] = (opts.filas ?? []).map((p) => nueva(p));
  function nueva(p: Partial<FilaFake>): FilaFake {
    seq += 1;
    return {
      id: seq,
      empresaId: 1,
      instancia: `krezka-1-${seq}`,
      tokenCifrado: null,
      estado: 'NO_CONECTADO',
      numero: null,
      nombrePerfil: null,
      conectadoEn: null,
      desconectadoEn: null,
      avisoDesconexionEn: null,
      enviadosHoy: 0,
      enviadosDia: null,
      creadoEn: new Date(),
      actualizadoEn: new Date(),
      ...p,
    };
  }
  const empresa = {
    takiyActivo: false,
    takiyAppKey: null,
    takiyAuthKey: null,
    takiyEnviarComprobante: false,
    nombreComercial: 'Bodega Ana',
    razonSocial: 'ANA SAC',
    ...(opts.empresa ?? {}),
  };
  const usuarios = opts.usuarios ?? [
    {
      id: 10,
      empresaId: 1,
      rol: 'ADMIN_EMPRESA',
      estado: 'ACTIVO',
      celular: '987654321',
      email: 'dueno@bodega.pe',
    },
  ];
  const copia = (f?: FilaFake) => (f ? { ...f } : null);
  const prisma = {
    filas,
    empresa: {
      findUnique: jest.fn(async () => ({ ...empresa })),
      update: jest.fn(async ({ data }: any) => Object.assign(empresa, data)),
    },
    usuario: {
      findMany: jest.fn(async ({ where }: any) =>
        usuarios.filter((u) => cumple(u, where)),
      ),
      findFirst: jest.fn(
        async ({ where }: any) =>
          usuarios.find((u) => cumple(u, where)) ?? null,
      ),
    },
    whatsappConexion: {
      findUnique: jest.fn(async ({ where }: any) =>
        copia(filas.find((f) => cumple(f, where))),
      ),
      create: jest.fn(async ({ data }: any) => {
        if (filas.some((f) => f.empresaId === data.empresaId)) {
          throw Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
          });
        }
        const f = nueva(data);
        filas.push(f);
        return copia(f);
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const f = filas.find((x) => cumple(x, where));
        if (!f) throw Object.assign(new Error('not found'), { code: 'P2025' });
        aplicar(f, data);
        return copia(f);
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hits = filas.filter((x) => cumple(x, where));
        hits.forEach((f) => aplicar(f, data));
        return { count: hits.length };
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const antes = filas.length;
        for (let i = filas.length - 1; i >= 0; i--)
          if (cumple(filas[i], where)) filas.splice(i, 1);
        return { count: antes - filas.length };
      }),
    },
  };
  return prisma;
}

export interface LlamadaFetch {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

/** fetch falso: responde según la ruta (el primer `match` que coincida). */
export function fetchFake(
  rutas: {
    match: RegExp;
    status?: number;
    body?: unknown;
    error?: Error;
  }[] = [],
) {
  const llamadas: LlamadaFetch[] = [];
  const impl = jest.fn(async (url: any, init: any) => {
    const u = String(url);
    llamadas.push({
      url: u,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      body: init?.body ? JSON.parse(init.body) : undefined,
    });
    const r = rutas.find((x) => x.match.test(`${init?.method ?? 'GET'} ${u}`));
    if (r?.error) throw r.error;
    const status = r?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r?.body ?? {},
    } as unknown as Response;
  });
  return { impl: impl as unknown as typeof fetch, llamadas, mock: impl };
}

export const ENV_EVOLUTION = {
  EVOLUTION_API_URL: 'http://evolution.railway.internal:8080/',
  EVOLUTION_API_KEY: 'LLAVE-GLOBAL-SUPER-SECRETA',
  EVOLUTION_WEBHOOK_SECRET: 'secreto-del-webhook-123',
  EVOLUTION_EMPRESAS_PILOTO: '1',
  EVOLUTION_PAUSA_MIN_MS: '3000',
  EVOLUTION_PAUSA_MAX_MS: '7000',
  BACKEND_URL: 'https://api.krezka.com',
};
