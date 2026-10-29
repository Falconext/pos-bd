/**
 * Envío por agencia desde la tienda virtual (29-10): el comprador elige la
 * agencia de Shalom u Olva y deja su DNI; el pedido llega con todo eso.
 */
import { BadRequestException } from '@nestjs/common';
import {
  agenciasOlva,
  agenciasShalom,
  couriersValidos,
  envioAgenciaDelPedido,
} from './envio-agencia';

describe('couriersValidos', () => {
  it('solo SHALOM y OLVA, sin repetidos y en orden', () => {
    expect(couriersValidos(['OLVA', 'DHL', 'SHALOM', 'OLVA'])).toEqual(['SHALOM', 'OLVA']);
    expect(couriersValidos(null)).toEqual([]);
  });
});

describe('envioAgenciaDelPedido', () => {
  const base = {
    tipoEntrega: 'ENVIO',
    envioCourier: 'shalom',
    envioAgenciaId: '123',
    envioAgenciaNombre: 'Cusco Centro',
    clienteDocumento: '45 678 912',
  };

  it('sin agencia elegida no hace nada (domicilio o recojo, como siempre)', () => {
    expect(envioAgenciaDelPedido({ tipoEntrega: 'ENVIO' }, ['SHALOM'])).toBeNull();
  });

  it('arma lo que se guarda, con el DNI limpio y la agencia legible', () => {
    expect(envioAgenciaDelPedido(base, ['SHALOM'])).toEqual({
      envioCourier: 'SHALOM',
      envioAgenciaId: '123',
      envioAgenciaNombre: 'Cusco Centro',
      clienteDocumento: '45678912',
      agenciaEnvio: 'Shalom - Cusco Centro',
    });
  });

  it.each([
    ['un courier que la tienda no ofrece', { ...base, envioCourier: 'OLVA' }],
    ['recojo en tienda', { ...base, tipoEntrega: 'RECOJO' }],
    ['sin agencia', { ...base, envioAgenciaNombre: '  ' }],
    ['DNI incompleto', { ...base, clienteDocumento: '1234' }],
  ])('rechaza %s', (_, dto) => {
    expect(() => envioAgenciaDelPedido(dto, ['SHALOM'])).toThrow(BadRequestException);
  });
});

describe('listas de agencias', () => {
  it('Shalom: sin las cerradas y ordenadas por departamento', () => {
    const r = agenciasShalom([
      { terId: '2', nombre: 'Wanchaq', departamento: 'CUSCO', provincia: 'CUSCO', distrito: 'WANCHAQ', estado: 'activo' },
      { terId: '3', nombre: 'Vieja', departamento: 'AREQUIPA', provincia: 'AREQUIPA', distrito: 'X', estado: 'inactivo' },
      { terId: '1', nombre: 'Cercado', departamento: 'AREQUIPA', provincia: 'AREQUIPA', distrito: 'CERCADO', estado: 'activo', direccion: 'Av. Goyeneche 1' },
    ]);
    expect(r.map((a) => a.id)).toEqual(['1', '2']);
    expect(r[0].direccion).toBe('Av. Goyeneche 1');
  });

  it('Olva: el código es el id', () => {
    const r = agenciasOlva([{ codigo: 'LIM01', nombre: 'Lince', departamento: 'LIMA', provincia: 'LIMA', distrito: 'LINCE' }]);
    expect(r).toEqual([{ id: 'LIM01', nombre: 'Lince', departamento: 'LIMA', provincia: 'LIMA', distrito: 'LINCE' }]);
  });
});
