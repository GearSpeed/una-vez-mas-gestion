import Big from 'big.js';

/**
 * Número decimal como texto ("17.55"). Así viajan los importes entre la BD
 * (`numeric`), la API y el front sin que el punto flotante se coma centavos.
 */
export type Decimal = string;

export const DECIMALES_DINERO = 2;
export const DECIMALES_COSTO = 6;
const DECIMALES_PROPORCION = 4;

function big(valor: Decimal | number): Big {
  return new Big(valor);
}

function fijar(valor: Big, decimales: number): Decimal {
  return valor.toFixed(decimales, Big.roundHalfUp);
}

const CERO_COSTO = fijar(big(0), DECIMALES_COSTO);

/* -----------------------------------------------------------------------------
   Compras: el costo del viaje, repartido por pieza (la lógica del Excel)
   -------------------------------------------------------------------------- */

export interface Viaje {
  /** Kilómetros de ida y vuelta hasta el proveedor. */
  readonly distanciaKm: Decimal;
  readonly rendimientoKmL: Decimal;
  readonly precioGasolina: Decimal;
}

/** Litros del viaje redondo: distancia ÷ rendimiento. */
export function litrosDelViaje(viaje: Viaje): Decimal {
  return fijar(big(viaje.distanciaKm).div(viaje.rendimientoKmL), 3);
}

/** Costo de la gasolina del viaje: distancia ÷ rendimiento × precio. Sin vehículo vale 0. */
export function costoTraslado(viaje: Viaje | null): Decimal {
  if (!viaje) return fijar(big(0), DECIMALES_DINERO);
  const costo = big(viaje.distanciaKm).div(viaje.rendimientoKmL).times(viaje.precioGasolina);
  return fijar(costo, DECIMALES_DINERO);
}

/** El traslado se reparte parejo entre todas las piezas de la compra. */
export function trasladoPorPieza(costo: Decimal, piezas: number): Decimal {
  if (piezas <= 0) return CERO_COSTO;
  return fijar(big(costo).div(piezas), DECIMALES_COSTO);
}

export interface LineaCompra {
  readonly cantidad: number;
  /** Lo que cobra el proveedor por pieza. */
  readonly costoProveedor: Decimal;
}

export interface LineaCompraCalculada {
  readonly costoTrasladoUnitario: Decimal;
  /** Proveedor + traslado: el costo con el que la pieza entra al inventario. */
  readonly costoUnitario: Decimal;
  readonly importe: Decimal;
}

export interface CompraCalculada {
  readonly litros: Decimal | null;
  readonly costoTraslado: Decimal;
  readonly piezas: number;
  readonly trasladoPorPieza: Decimal;
  readonly lineas: readonly LineaCompraCalculada[];
  /** Lo que se le pagó al proveedor. */
  readonly subtotalMercancia: Decimal;
  /** Mercancía + gasolina: lo que de verdad salió de la bolsa. */
  readonly total: Decimal;
}

/**
 * Toda la aritmética de una compra. La API la usa para guardar y el front para
 * mostrar el cálculo mientras se captura, así que los dos dan el mismo número.
 */
export function calcularCompra(
  viaje: Viaje | null,
  lineas: readonly LineaCompra[],
): CompraCalculada {
  const piezas = lineas.reduce((suma, linea) => suma + linea.cantidad, 0);
  const traslado = costoTraslado(viaje);
  const porPieza = trasladoPorPieza(traslado, piezas);

  const calculadas = lineas.map((linea) => {
    const unitario = big(linea.costoProveedor).plus(porPieza);
    return {
      costoTrasladoUnitario: porPieza,
      costoUnitario: fijar(unitario, DECIMALES_COSTO),
      importe: fijar(unitario.times(linea.cantidad), DECIMALES_DINERO),
    };
  });

  const subtotal = lineas.reduce(
    (suma, linea) => suma.plus(big(linea.costoProveedor).times(linea.cantidad)),
    big(0),
  );

  return {
    litros: viaje ? litrosDelViaje(viaje) : null,
    costoTraslado: traslado,
    piezas,
    trasladoPorPieza: porPieza,
    lineas: calculadas,
    subtotalMercancia: fijar(subtotal, DECIMALES_DINERO),
    total: fijar(subtotal.plus(traslado), DECIMALES_DINERO),
  };
}

/* -----------------------------------------------------------------------------
   Costo promedio ponderado móvil (uno por producto, para toda la empresa)
   -------------------------------------------------------------------------- */

/**
 * Promedio después de una entrada. `existencia` es la de toda la empresa antes
 * de la entrada; las salidas no lo mueven.
 */
export function promedioTrasEntrada(
  existencia: number,
  promedio: Decimal,
  cantidad: number,
  costo: Decimal,
): Decimal {
  if (existencia + cantidad <= 0) return fijar(big(promedio), DECIMALES_COSTO);
  if (existencia <= 0) return fijar(big(costo), DECIMALES_COSTO);
  const valor = big(promedio).times(existencia).plus(big(costo).times(cantidad));
  return fijar(valor.div(existencia + cantidad), DECIMALES_COSTO);
}

/**
 * Deshace una entrada: saca `cantidad` piezas valuadas a `costo`. Solo es exacto
 * si no hubo salidas después de esa entrada, que es la regla para cancelar compras.
 */
export function promedioTrasRetiro(
  existencia: number,
  promedio: Decimal,
  cantidad: number,
  costo: Decimal,
): Decimal {
  const resto = existencia - cantidad;
  if (resto <= 0) return fijar(big(promedio), DECIMALES_COSTO);
  const valor = big(promedio).times(existencia).minus(big(costo).times(cantidad));
  if (valor.lt(0)) return CERO_COSTO;
  return fijar(valor.div(resto), DECIMALES_COSTO);
}

/* -----------------------------------------------------------------------------
   Precio y márgenes
   -------------------------------------------------------------------------- */

export interface IndicadoresPrecio {
  /** Costo × (1 + ganancia objetivo). */
  readonly precioSugerido: Decimal | null;
  readonly gananciaPorPieza: Decimal | null;
  /** (precio − costo) ÷ costo, como proporción: 0.6751 = 67.51 %. */
  readonly gananciaSobreCosto: Decimal | null;
  /** (precio − costo) ÷ precio: lo que queda de cada peso vendido. */
  readonly margenSobrePrecio: Decimal | null;
}

/**
 * Los dos porcentajes que el Excel mezclaba, cada uno con su nombre. La ganancia
 * objetivo es sobre el costo. Si el producto nunca se ha comprado (costo 0) no se
 * puede calcular nada.
 */
export function indicadoresPrecio(
  costo: Decimal,
  precio: Decimal | null,
  gananciaObjetivo: Decimal | null,
): IndicadoresPrecio {
  const c = big(costo);
  const sinCosto = c.lte(0);
  const precioSugerido =
    sinCosto || gananciaObjetivo === null
      ? null
      : fijar(c.times(big(1).plus(gananciaObjetivo)), DECIMALES_DINERO);

  if (sinCosto || precio === null) {
    return {
      precioSugerido,
      gananciaPorPieza: null,
      gananciaSobreCosto: null,
      margenSobrePrecio: null,
    };
  }

  const p = big(precio);
  const ganancia = p.minus(c);
  return {
    precioSugerido,
    gananciaPorPieza: fijar(ganancia, DECIMALES_DINERO),
    gananciaSobreCosto: fijar(ganancia.div(c), DECIMALES_PROPORCION),
    margenSobrePrecio: p.gt(0) ? fijar(ganancia.div(p), DECIMALES_PROPORCION) : null,
  };
}

/* -----------------------------------------------------------------------------
   Ventas
   -------------------------------------------------------------------------- */

export interface LineaVenta {
  readonly cantidad: number;
  readonly precioUnitario: Decimal;
  /** Descuento de toda la línea, en pesos. */
  readonly descuento: Decimal;
}

export function importeLinea(linea: LineaVenta): Decimal {
  const bruto = big(linea.precioUnitario).times(linea.cantidad);
  return fijar(bruto.minus(linea.descuento), DECIMALES_DINERO);
}

/** El descuento no puede ser negativo ni mayor que la línea. */
export function descuentoValido(linea: LineaVenta): boolean {
  const descuento = big(linea.descuento);
  return descuento.gte(0) && descuento.lte(big(linea.precioUnitario).times(linea.cantidad));
}

export function totalVenta(lineas: readonly LineaVenta[]): Decimal {
  return sumar(lineas.map(importeLinea));
}

/* -----------------------------------------------------------------------------
   Utilidades
   -------------------------------------------------------------------------- */

export function sumar(valores: readonly Decimal[], decimales = DECIMALES_DINERO): Decimal {
  return fijar(
    valores.reduce((suma, valor) => suma.plus(valor), big(0)),
    decimales,
  );
}

export function multiplicar(
  a: Decimal | number,
  b: Decimal | number,
  decimales = DECIMALES_DINERO,
): Decimal {
  return fijar(big(a).times(b), decimales);
}

export function restar(a: Decimal, b: Decimal, decimales = DECIMALES_DINERO): Decimal {
  return fijar(big(a).minus(b), decimales);
}

/** a ÷ b; `null` si b es cero. */
export function dividir(a: Decimal, b: Decimal, decimales = DECIMALES_PROPORCION): Decimal | null {
  const divisor = big(b);
  if (divisor.eq(0)) return null;
  return fijar(big(a).div(divisor), decimales);
}

export function comparar(a: Decimal, b: Decimal): -1 | 0 | 1 {
  return big(a).cmp(b);
}

export function redondear(valor: Decimal, decimales = DECIMALES_DINERO): Decimal {
  return fijar(big(valor), decimales);
}
