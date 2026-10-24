/**
 * QA 23-10: el modelo prometía "alguien de ventas se contactará contigo" sin
 * llamar a derivar_a_asesor. El procesador deriva por él; esto decide cuándo.
 */
import { afirmaDerivacion } from './confirmacion-falsa';

const PROPIO =
  '¡Listo! 🙌 Alguien de nuestro equipo de ventas se contactará contigo por este mismo chat lo antes posible.';

describe('afirmaDerivacion', () => {
  it.each([
    PROPIO,
    'Para activar tu cuenta, te paso con alguien de nuestro equipo de ventas por este mismo chat.',
    'Ya le informé a un asesor y te escribirá en breve.',
    'Un asesor se comunicará contigo hoy.',
    'Perfecto, una persona del equipo te contactará por aquí.',
  ])('afirma: %s', (t) => {
    expect(afirmaDerivacion(t, PROPIO)).toBe(true);
  });

  it('el mensaje propio de la empresa cuenta aunque cambie el espaciado', () => {
    expect(afirmaDerivacion(`Gracias.\n\n${PROPIO.replace(' por este', '  por  este')}`, PROPIO)).toBe(true);
  });

  it.each([
    // Ofrecer no es derivar.
    '¿Te gustaría que alguien del equipo de ventas se comunique contigo?',
    '¿Quieres que te pase con alguien de ventas para verlo en vivo?',
    // Después de la demo, la que vuelve a escribir es la IA.
    'Tienes 3 horas para revisarla; más ratito te escribo para saber qué te pareció.',
    // Contactos de otras áreas: el cliente escribe, el chat no se pausa.
    'La capacitación inicial la ve Diego. Escríbele a su WhatsApp: 991 065 217.',
    'Diego te escribirá para coordinar la capacitación.',
    'El plan Corporativo está en S/ 99.90 al mes.',
  ])('no afirma: %s', (t) => {
    expect(afirmaDerivacion(t, PROPIO)).toBe(false);
  });

  it('sin mensaje propio configurado, igual detecta la promesa', () => {
    expect(afirmaDerivacion('Un asesor se comunicará contigo.', undefined)).toBe(true);
  });
});
