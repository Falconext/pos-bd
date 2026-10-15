/**
 * Las tarifas y los descuentos, escritos desde la configuración.
 *
 * El problema que resuelve: el mismo número vivía en dos sitios. En el texto
 * que el empresario edita —lo que la IA DICE— y en la configuración —lo que
 * el código CALCULA—. Medido sobre el contexto real de Hierba Sana, subir el
 * delivery de Lima de S/ 15 a S/ 18 obligaba a tocar cinco lugares: la
 * configuración más cuatro líneas sueltas en cuatro secciones distintas.
 * Olvidar una no rompe nada visible: el bot sigue cotizando bien y miente en
 * un solo caso, el más difícil de encontrar.
 *
 * Lo que se defiende acá: que el bloque diga exactamente lo que el sistema
 * cobra, y que una empresa sin configurar no reciba los números de otra.
 */
import { bloqueComercial } from './tarifas-y-descuentos';
import { CONFIG_ENVIO_HIERBA_SANA, SIN_CONFIG_ENVIO } from './envio-zonas';
import { REGLAS_HIERBA_SANA, SIN_DESCUENTO } from './reglas-descuento';
import { HORARIO_POR_DEFECTO } from './validaciones-pedido';

const HIERBA_SANA = {
  envio: CONFIG_ENVIO_HIERBA_SANA,
  horario: HORARIO_POR_DEFECTO,
  descuento: REGLAS_HIERBA_SANA,
};

const VACIA = {
  envio: SIN_CONFIG_ENVIO,
  horario: HORARIO_POR_DEFECTO,
  descuento: SIN_DESCUENTO,
};

describe('lo que dice el bloque de una empresa configurada', () => {
  const texto = bloqueComercial(HIERBA_SANA);

  it('trae las tarifas reales de cada zona', () => {
    expect(texto).toContain('Lima');
    expect(texto).toContain('S/ 15.00');
    expect(texto).toContain('Provincia');
    expect(texto).toContain('S/ 10.00');
  });

  it('dice cómo llega el pedido en cada zona, no el código interno', () => {
    // "DOMICILIO" en mayúsculas es jerga del sistema; el modelo se la copia
    // al cliente tal cual si se la damos así.
    expect(texto).toContain('entrega a domicilio');
    expect(texto).toContain('envío a agencia');
    expect(texto).not.toContain('DOMICILIO');
    expect(texto).not.toContain('AGENCIA');
  });

  it('no repite cómo llega cuando el nombre de la zona ya lo dice', () => {
    // "Recojo en tienda (recojo en tienda)" es lo que salía antes.
    expect(texto).toContain('- Recojo en tienda: sin costo.');
  });

  it('la nota de pago no queda en minúscula detrás de un punto', () => {
    expect(texto).toContain('S/ 15.00. El pago es contraentrega');
  });

  it('el recojo en tienda es "sin costo", no "S/ 0.00"', () => {
    // Decirle a alguien que paga cero soles suena a error del sistema.
    expect(texto).toContain('sin costo');
    expect(texto).not.toContain('S/ 0.00');
  });

  it('trae los tres escalones de descuento con sus condiciones', () => {
    for (const t of ['S/ 10.00', 'S/ 20.00', 'S/ 30.00']) {
      expect(texto).toContain(t);
    }
    expect(texto).toContain('3 o más unidades');
    expect(texto).toContain('mayor a S/ 90.00');
    expect(texto).toContain('mayor a S/ 250.00');
  });

  it('dice sobre qué se mide el escalón', () => {
    // Con el envío dentro o fuera cambia quién llega al tramo. Si el modelo
    // no lo sabe, promete descuentos que la cotización no da.
    expect(texto).toContain('el total con el envío incluido');
  });

  it('explica el mínimo por unidad y que no se acumulan', () => {
    expect(texto).toContain('mayor a S/ 20.00');
    expect(texto).toContain('no se acumulan');
    expect(texto).toContain('No negocies descuentos fuera de estos tramos');
  });

  it('se declara el que manda', () => {
    // Mientras un cliente siga teniendo los números copiados en su texto, las
    // dos versiones conviven en el prompt y el modelo necesita saber cuál
    // gana.
    expect(texto).toContain('la que vale es esta');
  });

  it('los escalones van de menor a mayor', () => {
    const pos = (s: string) => texto.indexOf(s);
    expect(pos('S/ 10.00 con 3')).toBeLessThan(pos('S/ 20.00 con 5'));
    expect(pos('S/ 20.00 con 5')).toBeLessThan(pos('S/ 30.00 con 7'));
  });
});

describe('una empresa sin configurar no hereda los números de otra', () => {
  it('sin nada configurado, el bloque está vacío', () => {
    // Es la regla del módulo: los valores de Hierba Sana dejaron de ser el
    // defecto porque cualquier tienda que encendía la IA empezaba a regalar
    // S/ 10 a S/ 30 sin que su dueño lo supiera.
    expect(bloqueComercial(VACIA)).toBe('');
  });

  it('con envío pero sin descuentos, no inventa una sección de descuentos', () => {
    const texto = bloqueComercial({ ...HIERBA_SANA, descuento: SIN_DESCUENTO });
    expect(texto).toContain('S/ 15.00');
    expect(texto).not.toContain('Descuentos:');
    // Y tampoco anuncia que no hay: es una invitación a pedir uno.
    expect(texto.toLowerCase()).not.toContain('no hay descuento');
  });

  it('con descuentos pero sin zonas, no inventa tarifas', () => {
    const texto = bloqueComercial({ ...HIERBA_SANA, envio: SIN_CONFIG_ENVIO });
    expect(texto).toContain('Descuentos:');
    expect(texto).not.toContain('Envío:');
  });
});

describe('el bloque sigue a la configuración, no al revés', () => {
  it('cambiar la tarifa en la configuración cambia lo que la IA dice', () => {
    // Es el punto entero: un solo lugar que tocar. Antes eran cinco.
    const subida = {
      ...HIERBA_SANA,
      envio: {
        ...CONFIG_ENVIO_HIERBA_SANA,
        zonas: CONFIG_ENVIO_HIERBA_SANA.zonas.map((z) =>
          z.nombre === 'Lima' ? { ...z, tarifa: 18 } : z,
        ),
      },
    };
    const texto = bloqueComercial(subida);
    expect(texto).toContain('S/ 18.00');
    expect(texto).not.toMatch(/Lima.*S\/ 15\.00/);
  });

  it('un tramo nuevo aparece solo', () => {
    const texto = bloqueComercial({
      ...HIERBA_SANA,
      descuento: {
        ...REGLAS_HIERBA_SANA,
        tramos: [
          ...REGLAS_HIERBA_SANA.tramos,
          { descuento: 50, unidades: 12, totalMayorQue: 400 },
        ],
      },
    });
    expect(texto).toContain('S/ 50.00 con 12 o más unidades');
  });
});
