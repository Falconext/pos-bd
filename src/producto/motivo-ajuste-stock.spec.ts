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
import {
  esPerdida,
  etiquetaDeMotivo,
  motivoDelConcepto,
} from './motivo-ajuste-stock';

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

describe('Leer el motivo de un movimiento ya registrado', () => {
    it('lo saca del concepto, que es donde quedó guardado', () => {
        // Así funciona también para lo que ya está en la base, sin migrar nada.
        expect(motivoDelConcepto('Merma (producto roto o dañado) · Ajuste de inventario (-9)'))
            .toEqual({ codigo: 'MERMA', etiqueta: 'Merma (producto roto o dañado)' });
    });

    it('una venta no tiene motivo: no es una merma', () => {
        expect(motivoDelConcepto('Venta Boleta B0A1-688')).toBeNull();
        expect(motivoDelConcepto('Compra F001-123')).toBeNull();
    });

    it('un ajuste viejo, sin motivo, tampoco cuenta', () => {
        // Meterlo inflaría la pérdida con algo que nadie puede explicar.
        expect(motivoDelConcepto('Ajuste manual de stock desde inventario (-3)')).toBeNull();
    });

    it('un concepto vacío o raro no revienta', () => {
        for (const v of [undefined, null, '', ' · ', 'algo · otra cosa']) {
            expect(motivoDelConcepto(v)).toBeNull();
        }
    });
});

describe('Qué cuenta como pérdida de mercadería', () => {
    it('merma, vencido y pérdida sí', () => {
        expect(esPerdida('Merma (producto roto o dañado) · Ajuste de inventario (-9)')).toBe(true);
        expect(esPerdida('Vencido o en mal estado · Ajuste de inventario (-2)')).toBe(true);
        expect(esPerdida('Pérdida o robo · Ajuste de inventario (-1)')).toBe(true);
    });

    it('una corrección de conteo NO es pérdida', () => {
        // Encontrar una unidad de más o corregir un error de registro no es
        // plata perdida: es el inventario poniéndose al día.
        expect(esPerdida('Encontrado en inventario · Ajuste de inventario (+1)')).toBe(false);
        expect(esPerdida('Error de registro anterior · Ajuste de inventario (-5)')).toBe(false);
        expect(esPerdida('Corrección por conteo físico · Ajuste de inventario (+3)')).toBe(false);
    });

    it('el consumo interno no es pérdida: es gasto del negocio', () => {
        expect(esPerdida('Consumo interno del negocio · Ajuste de inventario (-1)')).toBe(false);
    });

    it('una venta no es pérdida', () => {
        expect(esPerdida('Venta Boleta B0A1-688')).toBe(false);
    });
});
