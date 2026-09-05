import 'dotenv/config';
import { GeminiService } from '../src/gemini/gemini.service';
import { IaVentasService } from '../src/leads/leads-ia.service';

const ia = new IaVentasService(new GeminiService({ get: (k: string) => process.env[k] } as any));

const catalogo = [
  { id: 101, descripcion: 'Cemento Sol 42.5kg', precioUnitario: 28.5 },
  { id: 102, descripcion: 'Alambre negro #16 (kg)', precioUnitario: 6.9 },
  { id: 103, descripcion: 'Fierro corrugado 1/2"', precioUnitario: 35.0 },
];

const casos: { nombre: string; conv: { role: 'user' | 'assistant'; content: string }[]; esperado: string }[] = [
  {
    nombre: 'A) Pedido concreto (50 cemento + 10kg alambre)',
    conv: [
      { role: 'user', content: 'Quiero 50 bolsas de cemento sol y 10 kilos de alambre negro 16' },
      { role: 'assistant', content: '¿Confirmo el pedido?' },
      { role: 'user', content: 'Sí, confírmalo' },
    ],
    esperado: '[{id:101,cantidad:50},{id:102,cantidad:10}]',
  },
  {
    nombre: 'B) Solo preguntas, sin pedido → vacío',
    conv: [
      { role: 'user', content: 'hola, a cuánto está el cemento?' },
      { role: 'assistant', content: 'El Cemento Sol está a S/28.50.' },
      { role: 'user', content: 'ah ok, gracias, lo voy a pensar' },
    ],
    esperado: '[]',
  },
  {
    nombre: 'C) Menciona producto fuera de catálogo (clavos) + 20 cemento',
    conv: [
      { role: 'user', content: 'necesito 20 bolsas de cemento sol y una caja de clavos de 2 pulgadas' },
    ],
    esperado: 'solo [{id:101,cantidad:20}] (clavos no está en catálogo)',
  },
];

async function main() {
  if (!ia.disponible()) return console.log('❌ Gemini no disponible.');
  for (const c of casos) {
    const items = await ia.extraerItemsPedido(c.conv as any, catalogo);
    console.log(`\n=== ${c.nombre} ===`);
    console.log('items    :', JSON.stringify(items));
    console.log('esperado :', c.esperado);
  }
}

main().then(() => process.exit(0));
