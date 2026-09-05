import 'dotenv/config';
import { GeminiService } from '../src/gemini/gemini.service';
import { IaVentasService } from '../src/leads/leads-ia.service';

// ConfigService mínimo (solo necesita .get para GEMINI_API_KEY).
const configService = { get: (k: string) => process.env[k] } as any;
const gemini = new GeminiService(configService);
const ia = new IaVentasService(gemini);

const businessContext = `Negocio: Ferretería El Constructor (rubro: Ferretería).
Vendemos materiales de construcción y herramientas. Atendemos Lima.
PRODUCTOS DISPONIBLES (precio con IGV y stock actual del negocio). Usa SOLO estos datos para responder sobre productos, precios y disponibilidad; NO inventes precios ni stock. Si el cliente pide algo que no está en esta lista, dilo:
- Cemento Sol 42.5kg: S/28.50 (stock 40)
- Fierro corrugado 1/2": S/35.00 (sin stock)
- Alambre negro #16 (kg): S/6.90 (stock 120)`;

type Turno = { role: 'user' | 'assistant'; content: string };

const casos: { nombre: string; conv: Turno[]; buscar: string }[] = [
  {
    nombre: 'A) Precio de producto que NO está en el catálogo (taladro)',
    conv: [{ role: 'user', content: 'Hola, cuánto cuesta un taladro Bosch?' }],
    buscar: 'no debe inventar un precio del taladro',
  },
  {
    nombre: 'B) Pide un producto SIN stock (fierro 1/2")',
    conv: [{ role: 'user', content: 'Quiero 20 varillas de fierro corrugado de 1/2 pulgada, tienes?' }],
    buscar: 'no debe venderlo; debe decir que no hay stock y ofrecer alternativa',
  },
  {
    nombre: 'C) Producto en stock (cemento) — debe cotizar el precio real S/28.50',
    conv: [{ role: 'user', content: 'a cuanto el cemento sol?' }],
    buscar: 'debe decir S/28.50',
  },
];

async function main() {
  if (!ia.disponible()) {
    console.log('❌ Gemini no disponible (falta GEMINI_API_KEY).');
    return;
  }
  for (const c of casos) {
    process.stdout.write(`\n=== ${c.nombre} ===\n`);
    console.log(`PROSPECTO: ${c.conv[c.conv.length - 1].content}`);
    try {
      const r = await ia.generarRespuesta(c.conv as any, businessContext, c.conv.length);
      console.log(`ASESOR:    ${r.reply}`);
      console.log(`(esperado: ${c.buscar})`);
    } catch (e: any) {
      console.log(`⚠️  Error: ${e?.message || e}`);
    }
  }
}

main().then(() => process.exit(0));
