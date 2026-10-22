/**
 * Categorías, marcas y clientes desde la web del negocio.
 *
 * Los programadores lo pidieron al integrar: para crear un producto hace falta
 * el id de su categoría y su marca, y para facturar a una empresa conviene
 * tener el cliente guardado. Sin esto tenían que entrar al panel a crearlos.
 *
 * Puro: valida y normaliza. Lo que toca la base vive en `erp-datos.service.ts`.
 */
import { invalido, presente, soloConocidos, texto } from './entrada-producto';

/** El nombre de una categoría o marca. */
export function leerNombre(body: any, que: 'categoría' | 'marca'): string {
  soloConocidos(body, ['name'], {
    nombre: 'El nombre va en `name`.',
    image: `La imagen de la ${que} se pone desde el panel.`,
  });
  const nombre = texto(body, 'name', 100, true)!;
  return nombre.replace(/\s+/g, ' ');
}

/** Lo que guarda el panel en `Cliente.tipoDocumento`, por el nombre público. */
export const TIPO_DOC_PANEL: Record<string, 'DNI' | 'RUC' | 'CE' | 'PASAPORTE'> = {
  dni: 'DNI',
  ruc: 'RUC',
  ce: 'CE',
  passport: 'PASAPORTE',
};

/** Y al revés: el código de Catálogo 06 que guarda la base, al nombre público. */
export const DOC_PUBLICO: Record<string, string> = { '1': 'dni', '6': 'ruc', '4': 'ce', '7': 'passport', '0': 'none' };

export interface ClienteEntrada {
  tipo?: 'DNI' | 'RUC' | 'CE' | 'PASAPORTE';
  numero?: string;
  nombre?: string;
  email?: string;
  telefono?: string;
  direccion?: string;
}

const CAMPOS = ['document_type', 'document_number', 'name', 'email', 'phone', 'address'];
const PISTAS_CLIENTE: Record<string, string> = {
  ruc: 'Manda `document_type: "ruc"` y el número en `document_number`.',
  dni: 'Manda `document_type: "dni"` y el número en `document_number`.',
  telefono: 'El celular va en `phone`.',
  direccion: 'La dirección va en `address`.',
};

function email(o: any): string | undefined {
  const e = texto(o, 'email', 120);
  if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw invalido('email', '`email` no parece un correo válido.');
  return e || undefined;
}

function telefono(o: any): string | undefined {
  const t = texto(o, 'phone', 30)?.replace(/[\s-]/g, '');
  if (t && !/^\+?\d{6,15}$/.test(t)) throw invalido('phone', '`phone` tiene que ser un número (ej. 987654321 o +51987654321).');
  return t || undefined;
}

/** Alta: documento y nombre obligatorios; el número se valida como en el panel. */
export function leerClienteNuevo(body: any): ClienteEntrada {
  soloConocidos(body, CAMPOS, PISTAS_CLIENTE);
  const tipoPublico = texto(body, 'document_type', 10, true)!;
  const tipo = TIPO_DOC_PANEL[tipoPublico];
  if (!tipo) throw invalido('document_type', `\`document_type\` es uno de: ${Object.keys(TIPO_DOC_PANEL).join(', ')}.`);
  const numero = texto(body, 'document_number', 20, true)!.replace(/\s/g, '');
  if (tipo === 'DNI' && !/^\d{8}$/.test(numero)) throw invalido('document_number', 'El DNI tiene 8 dígitos.');
  if (tipo === 'RUC' && !/^(10|15|17|20)\d{9}$/.test(numero)) {
    throw invalido('document_number', 'El RUC tiene 11 dígitos y empieza con 10, 15, 17 o 20.');
  }
  return {
    tipo,
    numero,
    nombre: texto(body, 'name', 200, true)!,
    email: email(body),
    telefono: telefono(body),
    direccion: texto(body, 'address', 250) || undefined,
  };
}

/** Cambio: solo nombre y datos de contacto. El documento no cambia: es lo que lo identifica. */
export function leerCambioCliente(body: any): ClienteEntrada {
  soloConocidos(body, ['name', 'email', 'phone', 'address'], {
    ...PISTAS_CLIENTE,
    document_number: 'El documento no se cambia: es lo que identifica al cliente. Si está mal, crea el cliente con el correcto.',
    document_type: 'El documento no se cambia: es lo que identifica al cliente.',
  });
  if (!Object.keys(body).length) throw invalido('body', 'No mandaste ningún campo para cambiar.');
  return {
    nombre: presente(body, 'name') ? texto(body, 'name', 200, true) : undefined,
    email: presente(body, 'email') ? email(body) ?? '' : undefined,
    telefono: presente(body, 'phone') ? telefono(body) ?? '' : undefined,
    direccion: presente(body, 'address') ? texto(body, 'address', 250) ?? '' : undefined,
  };
}
