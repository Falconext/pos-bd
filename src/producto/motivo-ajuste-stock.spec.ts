/**
 * Los motivos del ajuste manual de stock.
 *
 * Pedido de DEMENVER: el inventario dejaba quitar nueve audífonos pero no decir
 * por qué. En el kardex todo salía como "Ajuste manual de stock desde
 * inventario (-9)" y lo único guardado era quién lo hizo.
 *
 * Su sistema anterior resolvía esto con un comentario libre por salida ("ERROR
 * DE INGRESO", "se uso para el local"). Acá se guarda el motivo elegido —para
 * poder contar las mermas después— más un detalle en palabras.
 */
import { etiquetaDeMotivo } from './motivo-ajuste-stock';

describe('El motivo se guarda en palabras, no en código', () => {
    it('traduce los motivos de salida', () => {
        expect(etiquetaDeMotivo('MERMA')).toBe('Merma (producto roto o dañado)');
        expect(etiquetaDeMotivo('PERDIDA')).toBe('Pérdida o robo');
        expect(etiquetaDeMotivo('CONSUMO_INTERNO')).toBe('Consumo interno del negocio');
    });

    it('traduce los de ingreso', () => {
        // El caso que contó DEMENVER: encontraron una unidad de más en la caja.
        expect(etiquetaDeMotivo('ENCONTRADO')).toBe('Encontrado en inventario');
        expect(etiquetaDeMotivo('DEVOLUCION_CLIENTE')).toBe('Devolución de un cliente');
    });

    it('acepta minúsculas y espacios', () => {
        expect(etiquetaDeMotivo(' merma ')).toBe('Merma (producto roto o dañado)');
    });
});

describe('Sin motivo, el kardex queda como estaba', () => {
    it('no inventa una etiqueta cuando no vino nada', () => {
        for (const v of [undefined, null, '', '   ']) {
            expect(etiquetaDeMotivo(v)).toBe('');
        }
    });
});

describe('Un código desconocido no se descarta', () => {
    it('se devuelve tal cual', () => {
        // Preferible un kardex que diga algo raro a uno que no diga nada: eso
        // último es el problema que esto vino a resolver. Pasaría si el POS
        // agrega un motivo nuevo y acá no se refleja.
        expect(etiquetaDeMotivo('MOTIVO_NUEVO')).toBe('MOTIVO_NUEVO');
    });
});
