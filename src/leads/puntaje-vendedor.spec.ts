/**
 * Puntaje del vendedor (29-10, idea de YaVendió): cuenta fija, sin IA.
 */
import { calcularPuntaje, type DatosPuntaje } from './puntaje-vendedor';

const VACIO: DatosPuntaje = {
  whatsappConectado: false,
  iaActiva: false,
  productosConPrecio: 0,
  productosConFoto: 0,
  asesor: '',
  audiencia: '',
  estilo: '',
  reglas: '',
  saludo: false,
  temasConocimiento: 0,
  largoContexto: 0,
  documentosIndexados: 0,
  zonasEnvio: 0,
  mediosPago: 0,
  mensajeDerivacion: '',
};

const COMPLETO: DatosPuntaje = {
  whatsappConectado: true,
  iaActiva: true,
  productosConPrecio: 100,
  productosConFoto: 80,
  asesor: 'Nicky',
  audiencia: 'Dueños de bodegas',
  estilo: 'Cercano',
  reglas: 'SIEMPRE ofrece la demo',
  saludo: true,
  temasConocimiento: 5,
  largoContexto: 0,
  documentosIndexados: 2,
  zonasEnvio: 2,
  mediosPago: 1,
  mensajeDerivacion: 'Te paso con ventas',
};

describe('calcularPuntaje', () => {
  it('todo configurado suma 100 y queda listo', () => {
    const p = calcularPuntaje(COMPLETO);
    expect(p.puntaje).toBe(100);
    expect(p.nivel).toBe('LISTO');
  });

  it('vacío suma 0, y lo que falta va primero, de lo que más suma a lo que menos', () => {
    const p = calcularPuntaje(VACIO);
    expect(p.puntaje).toBe(0);
    expect(p.nivel).toBe('FALTA');
    const puntos = p.items.map((i) => i.puntos);
    expect(puntos).toEqual([...puntos].sort((a, b) => b - a));
  });

  it('pocas fotos no suman, y el consejo dice el porcentaje', () => {
    const p = calcularPuntaje({ ...COMPLETO, productosConFoto: 30 });
    const fotos = p.items.find((i) => i.id === 'fotos')!;
    expect(fotos.ok).toBe(false);
    expect(fotos.consejo).toContain('30%');
    expect(p.items[0].id).toBe('fotos');
    expect(p.nivel).toBe('LISTO');
  });

  it('el texto general largo cuenta como conocimiento aunque no haya temas', () => {
    const p = calcularPuntaje({ ...COMPLETO, temasConocimiento: 0, largoContexto: 800 });
    expect(p.items.find((i) => i.id === 'conocimiento')!.ok).toBe(true);
  });
});
