import { describe, expect, it } from 'vitest';
import {
  calcularCompra,
  costoTraslado,
  descuentoValido,
  importeLinea,
  indicadoresPrecio,
  litrosDelViaje,
  promedioTrasEntrada,
  promedioTrasRetiro,
  totalVenta,
  trasladoPorPieza,
} from './calculos.js';

/** El viaje V001 del Excel: 40 km de ida y vuelta, a 32 km/l, con la gasolina a $23. */
const V001 = { distanciaKm: '40', rendimientoKmL: '32', precioGasolina: '23' };

/** Las 8 líneas de la compra V001 del Excel, tal como estaban (chispas dos veces). */
const LINEAS_V001 = [
  { cantidad: 10, costoProveedor: '17.55' }, // tejocote
  { cantidad: 10, costoProveedor: '16.58' }, // chispas
  { cantidad: 10, costoProveedor: '15.60' }, // granola
  { cantidad: 10, costoProveedor: '17.00' }, // nuez
  { cantidad: 10, costoProveedor: '15.60' }, // avena
  { cantidad: 10, costoProveedor: '16.58' }, // chispas (renglón repetido)
  { cantidad: 10, costoProveedor: '17.55' }, // piña
  { cantidad: 10, costoProveedor: '14.14' }, // canela
];

describe('compra con viaje (paridad con el Excel)', () => {
  it('calcula litros y costo del viaje V001', () => {
    expect(litrosDelViaje(V001)).toBe('1.250');
    expect(costoTraslado(V001)).toBe('28.75');
  });

  it('reparte la gasolina entre las 80 piezas', () => {
    const compra = calcularCompra(V001, LINEAS_V001);
    expect(compra.piezas).toBe(80);
    expect(compra.trasladoPorPieza).toBe('0.359375');
    expect(compra.lineas[0]?.costoUnitario).toBe('17.909375');
  });

  it('suma mercancía y gasolina en el total', () => {
    const compra = calcularCompra(V001, LINEAS_V001);
    expect(compra.subtotalMercancia).toBe('1306.00');
    expect(compra.total).toBe('1334.75');
  });

  it('sin vehículo el traslado vale cero', () => {
    const compra = calcularCompra(null, [{ cantidad: 5, costoProveedor: '10' }]);
    expect(compra.litros).toBeNull();
    expect(compra.costoTraslado).toBe('0.00');
    expect(compra.lineas[0]?.costoUnitario).toBe('10.000000');
  });

  it('no divide entre cero si no hay piezas', () => {
    expect(trasladoPorPieza('28.75', 0)).toBe('0.000000');
  });
});

describe('precio y márgenes', () => {
  it('da los mismos números que el Excel para el tejocote a $30', () => {
    const indicadores = indicadoresPrecio('17.909375', '30.00', '0.8');
    expect(indicadores.precioSugerido).toBe('32.24');
    expect(indicadores.gananciaPorPieza).toBe('12.09');
    expect(indicadores.margenSobrePrecio).toBe('0.4030');
    expect(indicadores.gananciaSobreCosto).toBe('0.6751');
  });

  it('sin costo no inventa márgenes', () => {
    expect(indicadoresPrecio('0', '30', '0.8')).toEqual({
      precioSugerido: null,
      gananciaPorPieza: null,
      gananciaSobreCosto: null,
      margenSobrePrecio: null,
    });
  });

  it('sin precio solo da el sugerido', () => {
    const indicadores = indicadoresPrecio('10', null, '0.5');
    expect(indicadores.precioSugerido).toBe('15.00');
    expect(indicadores.gananciaPorPieza).toBeNull();
  });
});

describe('costo promedio ponderado móvil', () => {
  it('la primera entrada fija el promedio', () => {
    expect(promedioTrasEntrada(0, '0', 10, '17.909375')).toBe('17.909375');
  });

  it('pondera por cantidad', () => {
    // 10 a $10 y 30 a $20 → (100 + 600) / 40 = 17.5
    expect(promedioTrasEntrada(10, '10', 30, '20')).toBe('17.500000');
  });

  it('retirar la última entrada devuelve el promedio anterior', () => {
    const tras = promedioTrasEntrada(10, '10', 30, '20');
    expect(promedioTrasRetiro(40, tras, 30, '20')).toBe('10.000000');
  });

  it('retirar todo deja el promedio como estaba', () => {
    expect(promedioTrasRetiro(10, '12.5', 10, '12.5')).toBe('12.500000');
  });
});

describe('ventas', () => {
  it('resta el descuento de la línea', () => {
    expect(importeLinea({ cantidad: 3, precioUnitario: '30', descuento: '5' })).toBe('85.00');
  });

  it('suma las líneas', () => {
    expect(
      totalVenta([
        { cantidad: 2, precioUnitario: '30', descuento: '0' },
        { cantidad: 1, precioUnitario: '45.50', descuento: '0.50' },
      ]),
    ).toBe('105.00');
  });

  it('no acepta descuentos mayores que la línea', () => {
    expect(descuentoValido({ cantidad: 1, precioUnitario: '30', descuento: '30' })).toBe(true);
    expect(descuentoValido({ cantidad: 1, precioUnitario: '30', descuento: '30.01' })).toBe(false);
    expect(descuentoValido({ cantidad: 1, precioUnitario: '30', descuento: '-1' })).toBe(false);
  });
});
