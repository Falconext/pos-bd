/**
 * Que el modelo no pueda inventar los datos de entrega.
 *
 * El caso que defiende este archivo es el de Hierba Sana del 2026-10-16: con
 * el pago ya hecho y `registrar_pedido` pidiendo DNI, celular y agencia, el
 * modelo los rellenó en vez de preguntarlos, y la NV01-00000006 salió con un
 * destinatario inexistente.
 *
 * Lo que no puede romperse al defender eso: el cliente que SÍ dicta sus
 * datos, los escriba como los escriba.
 */
import {
  digitosDichosPorElCliente,
  textoDichoPorElCliente,
} from './procedencia-datos';

describe('procedencia de los datos de entrega', () => {
  describe('DNI y celular', () => {
    it('acepta el número que el cliente escribió', () => {
      expect(
        digitosDichosPorElCliente('84956217', ['mi dni es 84956217']),
      ).toBe(true);
    });

    it('rechaza el número que no está en ningún mensaje', () => {
      // Es el caso real: el cliente nunca dijo su DNI.
      expect(
        digitosDichosPorElCliente('84956217', [
          'quiero cardiox',
          'es para mi, soy de cusco',
          'ok, donde puedo yapear?',
        ]),
      ).toBe(false);
    });

    it('tolera cómo escribe la gente los números', () => {
      for (const escrito of [
        'mi celu es 987 654 321',
        '987-654-321',
        'anota +51 987654321',
        'Celular: 987654321.',
      ]) {
        expect(digitosDichosPorElCliente('987654321', [escrito])).toBe(true);
      }
    });

    it('acepta el celular con prefijo cuando el cliente dio los 9 dígitos', () => {
      expect(
        digitosDichosPorElCliente('51987654321', ['mi numero es 987654321']),
      ).toBe(true);
    });

    describe('lo que NO debe pasar', () => {
      it('no da por dicho un número que se forma pegando dos mensajes', () => {
        // "84956" del primero y "217" del segundo no son un DNI que nadie
        // escribió. Si se comparara contra el historial pegado, pasaría.
        expect(
          digitosDichosPorElCliente('84956217', ['son 84956', '217 soles']),
        ).toBe(false);
      });

      it('un valor vacío nunca cuenta como dicho', () => {
        expect(digitosDichosPorElCliente('', ['84956217'])).toBe(false);
        expect(digitosDichosPorElCliente(null, ['84956217'])).toBe(false);
      });

      it('sin mensajes del cliente, nada está dicho', () => {
        expect(digitosDichosPorElCliente('987654321', [])).toBe(false);
      });
    });
  });

  describe('dirección', () => {
    it('acepta la dirección aunque el modelo la acomode', () => {
      expect(
        textoDichoPorElCliente('Av. Larco 123 Dpto 4', [
          'vivo en la avenida larco 123, departamento 4',
        ]),
      ).toBe(true);
    });

    it('no se traba con tildes ni mayúsculas', () => {
      expect(
        textoDichoPorElCliente('Jr. Ancash 250', ['jiron ancash 250']),
      ).toBe(true);
    });

    it('rechaza la dirección que el cliente nunca dio', () => {
      expect(
        textoDichoPorElCliente('Av. Los Próceres 456', [
          'quiero 3 cardiox',
          'soy de cusco',
        ]),
      ).toBe(false);
    });

    it('no le alcanza con las palabras de relleno', () => {
      // "av" y "nro" aparecen en cualquier conversación de envíos: si
      // contaran, cualquier dirección inventada pasaría.
      expect(textoDichoPorElCliente('Av. 123', ['mandalo a mi av'])).toBe(
        false,
      );
    });
  });
});
