import {
  precioConDescuento,
  resolverListaPrecioAplicable,
} from './lista-precio.resolver';

/**
 * Precedencia de listas de precio.
 *
 * Es la regla que decide cuánto se cobra, así que conviene tenerla clavada:
 * un cambio accidental acá no rompe ninguna pantalla, solo hace que el negocio
 * cobre distinto sin que nadie se entere hasta cuadrar caja.
 */
describe('Qué lista de precios aplica', () => {
  /**
   * Prisma de mentira: devuelve la primera lista del catálogo que calce con el
   * `where` recibido. Así el test comprueba el ORDEN en que se pregunta, que
   * es justamente lo que define la precedencia.
   */
  const prismaCon = (listas: any[]) =>
    ({
      listaPrecio: {
        findFirst: async ({ where }: any) => {
          const candidatas = listas.filter((l) => {
            if (where.id != null && l.id !== where.id) return false;
            if (where.empresaId !== l.empresaId) return false;
            if (where.activo === true && !l.activo) return false;
            if (where.esPorDefecto === false && l.esPorDefecto) return false;
            if (where.esPorDefecto === true && !l.esPorDefecto) return false;
            if (where.clientes && !l.clienteIds?.includes(where.clientes.some.clienteId)) return false;
            if (where.usuarios && !l.usuarioIds?.includes(where.usuarios.some.usuarioId)) return false;
            if (where.sedes && !l.sedeIds?.includes(where.sedes.some.sedeId)) return false;
            return true;
          });
          candidatas.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.id - b.id);
          return candidatas[0] ?? null;
        },
      },
    }) as any;

  const EMPRESA = 23;
  const base = { empresaId: EMPRESA, activo: true, esPorDefecto: false, orden: 0 };

  const general = { ...base, id: 1, nombre: 'General', esPorDefecto: true };
  const delCliente = { ...base, id: 2, nombre: 'Pactado', clienteIds: [155] };
  const delUsuario = { ...base, id: 3, nombre: 'Bar', usuarioIds: [636] };
  const deLaSede = { ...base, id: 4, nombre: 'Sede Centro', sedeIds: [18] };
  const catalogo = [general, delCliente, delUsuario, deLaSede];

  const resolver = (opts: any) =>
    resolverListaPrecioAplicable(prismaCon(catalogo), {
      empresaId: EMPRESA,
      ...opts,
    });

  it('la elegida a mano gana sobre todo lo demás', async () => {
    // El cajero es el único que sabe si el trago se lo llevan o se lo toman acá.
    const r = await resolver({
      listaPrecioIdExplicita: 1,
      clienteId: 155,
      usuarioId: 636,
      sedeId: 18,
    });
    expect(r?.nombre).toBe('General');
  });

  it('el cliente gana sobre el vendedor: lo pactado no depende de quién atienda', async () => {
    const r = await resolver({ clienteId: 155, usuarioId: 636, sedeId: 18 });
    expect(r?.nombre).toBe('Pactado');
  });

  it('sin cliente, manda la del vendedor', async () => {
    const r = await resolver({ usuarioId: 636, sedeId: 18 });
    expect(r?.nombre).toBe('Bar');
  });

  it('sin cliente ni vendedor con lista propia, manda la del local', async () => {
    const r = await resolver({ usuarioId: 999, sedeId: 18 });
    expect(r?.nombre).toBe('Sede Centro');
  });

  it('si nada específico aplica, cae en la general', async () => {
    const r = await resolver({ usuarioId: 999, sedeId: 999 });
    expect(r?.nombre).toBe('General');
  });

  it('la general no compite como lista "del usuario": asignarla no clava a nadie', async () => {
    // Si compitiera, poner al dueño en la lista general le impediría recibir
    // la lista propia de su local.
    const conGeneralDelUsuario = [
      { ...general, usuarioIds: [636] },
      deLaSede,
    ];
    const r = await resolverListaPrecioAplicable(prismaCon(conGeneralDelUsuario), {
      empresaId: EMPRESA,
      usuarioId: 636,
      sedeId: 18,
    });
    expect(r?.nombre).toBe('Sede Centro');
  });

  it('entre dos candidatas del mismo tipo gana la de `orden` menor', async () => {
    const dos = [
      { ...base, id: 10, nombre: 'Segunda', usuarioIds: [636], orden: 5 },
      { ...base, id: 11, nombre: 'Primera', usuarioIds: [636], orden: 1 },
    ];
    const r = await resolverListaPrecioAplicable(prismaCon(dos), {
      empresaId: EMPRESA,
      usuarioId: 636,
    });
    expect(r?.nombre).toBe('Primera');
  });

  it('a igual orden desempata el id, para que el resultado no sea azaroso', async () => {
    const dos = [
      { ...base, id: 21, nombre: 'B', usuarioIds: [636] },
      { ...base, id: 20, nombre: 'A', usuarioIds: [636] },
    ];
    const r = await resolverListaPrecioAplicable(prismaCon(dos), {
      empresaId: EMPRESA,
      usuarioId: 636,
    });
    expect(r?.nombre).toBe('A');
  });

  it('una lista inactiva no aplica aunque esté asignada', async () => {
    const r = await resolverListaPrecioAplicable(
      prismaCon([{ ...delUsuario, activo: false }, general]),
      { empresaId: EMPRESA, usuarioId: 636 },
    );
    expect(r?.nombre).toBe('General');
  });

  it('una lista elegida a mano que no existe se ignora y sigue la resolución normal', async () => {
    // Pasar un id inválido no puede dejar la venta sin precios.
    const r = await resolver({ listaPrecioIdExplicita: 99999, usuarioId: 636 });
    expect(r?.nombre).toBe('Bar');
  });

  it('sin ninguna lista aplicable devuelve null y el llamador usa el precio base', async () => {
    const r = await resolverListaPrecioAplicable(prismaCon([]), {
      empresaId: EMPRESA,
      usuarioId: 636,
    });
    expect(r).toBeNull();
  });

  it('no cruza empresas: una lista de otra empresa nunca aplica', async () => {
    const ajena = [{ ...delUsuario, empresaId: 999 }];
    const r = await resolverListaPrecioAplicable(prismaCon(ajena), {
      empresaId: EMPRESA,
      usuarioId: 636,
    });
    expect(r).toBeNull();
  });
});

/**
 * Descuento de la lista.
 *
 * El campo existía desde la Fase 2 pero NO se aplicaba a ningún precio: se
 * guardaba y se leía de vuelta, nada más. Estos tests fijan que el descuento
 * llegue al precio y que lo haga igual en el catálogo y en el carrito.
 */
describe('Descuento de la lista sobre el precio', () => {
  it('descuenta el porcentaje indicado', () => {
    expect(precioConDescuento(10, 12.5)).toBe(8.75);
  });

  it('sin descuento devuelve el precio tal cual', () => {
    expect(precioConDescuento(10, null)).toBe(10);
    expect(precioConDescuento(10, 0)).toBe(10);
  });

  it('redondea a dos decimales: es dinero', () => {
    // Sin redondear, el total del carrito no cuadraba contra el comprobante.
    expect(precioConDescuento(7, 33.333)).toBe(4.67);
  });

  it('acepta Decimal de Prisma sin que el llamador convierta', () => {
    const decimal = { toString: () => '10.0000' };
    expect(precioConDescuento(decimal as any, 50)).toBe(5);
  });

  it('ignora un descuento imposible en vez de producir un precio absurdo', () => {
    expect(precioConDescuento(10, 100)).toBe(10);
    expect(precioConDescuento(10, 150)).toBe(10);
    expect(precioConDescuento(10, -5)).toBe(10);
  });

  it('un precio no numérico no revienta la venta: devuelve 0', () => {
    expect(precioConDescuento('abc' as any, 10)).toBe(0);
  });
});
