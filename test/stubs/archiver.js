/**
 * Stub de `archiver` para Jest. El paquete pasó a ser ESM puro en la v8 y Jest
 * no transforma node_modules, así que cualquier suite que importe
 * comprobante.service no llegaba ni a arrancar. En runtime no hace falta:
 * Node 22 sí puede require() un módulo ESM.
 *
 * Ninguna prueba ejercita la generación de ZIP; si alguna lo hace algún día,
 * este stub tiene que crecer o mockearse en esa suite.
 */
const noop = () => archiver;
const archiver = {
  append: noop,
  directory: noop,
  finalize: () => Promise.resolve(),
  pipe: noop,
  on: noop,
  pointer: () => 0,
};
module.exports = () => archiver;
module.exports.create = () => archiver;
