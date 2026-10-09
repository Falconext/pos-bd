import 'dotenv/config';
import { GeminiService } from '../src/gemini/gemini.service';
import { IaVentasService } from '../src/leads/leads-ia.service';

const configService = { get: (k: string) => process.env[k] } as any;
const ia = new IaVentasService(new GeminiService(configService));

const businessContext = `Negocio: Ferretería El Constructor (rubro: Ferretería). Atendemos Lima.
PRODUCTOS DISPONIBLES (precio con IGV y stock). NO inventes precios ni stock:
- Cemento Sol 42.5kg: S/28.50 (stock 40)
- Alambre negro #16 (kg): S/6.90 (stock 120)`;

// Conversación de HOT LEAD con interés concreto: producto + cantidad + presupuesto + urgencia.
const conv = [
  { role: 'user', content: 'Hola, necesito cemento sol' },
  { role: 'assistant', content: 'El Cemento Sol 42.5kg está a S/28.50 con stock. ¿Cuántas bolsas necesitas y en qué zona la entrega?' },
  { role: 'user', content: 'Necesito 50 bolsas para una obra en San Juan de Lurigancho, las necesito para este viernes. Tengo un presupuesto de S/1500. Yo soy el dueño.' },
  { role: 'assistant', content: 'Perfecto, con 50 bolsas cubrimos tu obra. ¿Confirmo el pedido para entrega el viernes?' },
  { role: 'user', content: 'Sí, confírmalo por favor' },
];

async function main() {
  if (!ia.disponible()) return console.log('❌ Gemini no disponible.');
  const cal = await ia.analizarConversacion(conv as any, businessContext);
  console.log('Score total :', cal.score.total, `(B${cal.score.budget} A${cal.score.authority} N${cal.score.need} T${cal.score.timeline})`);
  console.log('Status      :', cal.status, '| debeTransferir:', cal.debeTransferir);
  console.log('🛒 Interés  :', cal.interes || '(vacío)');
  console.log('📋 Resumen  :', cal.resumen);
  console.log('👉 Acción   :', cal.proximaAccion);
}

main().then(() => process.exit(0));
