import 'dotenv/config';
import { GeminiService } from '../src/gemini/gemini.service';
import { IaVentasService } from '../src/leads/leads-ia.service';
const ia = new IaVentasService(new GeminiService({ get: (k: string) => process.env[k] } as any));
(async () => {
  try { await ia.generarRespuesta([{ role:'user', content:'hola' }] as any, 'Negocio: Krezka.', 1); console.log('OK'); }
  catch (e:any){ const m=e?.message||''; console.log((m.includes('429')||m.toLowerCase().includes('quota'))?'429':'ERR'); }
})().then(()=>process.exit(0)).catch(()=>process.exit(0));
