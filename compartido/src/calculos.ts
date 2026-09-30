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
   Descuento por volumen
   -------------------------------------------------------------------------- */

/** Los dos escalones de una categoría. `desde` en cero significa «sin escalón». */
export interface EscalonesCategoria {
  readonly desde1: number;
  readonly tasa1: Decimal;
  readonly desde2: number;
  readonly tasa2: Decimal;
}

export interface LineaConCategoria {
  readonly productoId: number;
  readonly categoriaId: number;
  readonly cantidad: number;
  readonly precioUnitario: Decimal;
}

/**
 * Cuánto se le descuenta a cada línea por llevar cantidad.
 *
 * **Las piezas se cuentan por categoría, no por producto**: tres de avena y tres de coco
 * son seis galletas, y el descuento entra en las dos líneas. Es como compra la gente, y
 * es la razón de que esto no se pueda resolver línea por línea.
 *
 * De los dos escalones se toma **el más alto que se alcance**. El resultado es el
 * descuento en pesos de la línea completa, redondeado a dos decimales como todo el dinero
 * del sistema.
 *
 * Vive aquí, y no en la API ni en la pantalla, porque las dos tienen que llegar al mismo
 * número: si la pantalla cobrara un centavo distinto del que calcula el servidor, la venta
 * se rechazaría por no cuadrar con los pagos.
 */
export function descuentoPorVolumen(
  lineas: readonly LineaConCategoria[],
  escalones: ReadonlyMap<number, EscalonesCategoria>,
): Map<number, Decimal> {
  const piezasPorCategoria = new Map<number, number>();
  for (const linea of lineas) {
    piezasPorCategoria.set(
      linea.categoriaId,
      (piezasPorCategoria.get(linea.categoriaId) ?? 0) + linea.cantidad,
    );
  }

  const descuentos = new Map<number, Decimal>();
  for (const linea of lineas) {
    const tasa = tasaQueAplica(
      escalones.get(linea.categoriaId),
      piezasPorCategoria.get(linea.categoriaId) ?? 0,
    );
    if (tasa === null) continue;
    descuentos.set(
      linea.productoId,
      fijar(big(linea.precioUnitario).times(linea.cantidad).times(tasa), DECIMALES_DINERO),
    );
  }
  return descuentos;
}

/** El escalón más alto que alcanzan esas piezas, o `null` si no llega a ninguno. */
function tasaQueAplica(escalones: EscalonesCategoria | undefined, piezas: number): Decimal | null {
  if (!escalones) return null;
  if (escalones.desde2 > 0 && piezas >= escalones.desde2) return escalones.tasa2;
  if (escalones.desde1 > 0 && piezas >= escalones.desde1) return escalones.tasa1;
  return null;
}

/* -----------------------------------------------------------------------------
   Comisión del cobro con tarjeta (Mercado Pago) y devoluciones
   -------------------------------------------------------------------------- */

export interface TasaComision {
  /** Comisión sobre el cobro, como proporción: 0.0350 = 3.50 %. */
  readonly tasa: Decimal;
  /** IVA sobre la comisión (no sobre la venta): 0.16. */
  readonly iva: Decimal;
}

export interface Comision {
  readonly base: Decimal;
  readonly iva: Decimal;
  /** Lo que retiene la entidad. */
  readonly total: Decimal;
  /** Lo que llega a la cuenta. */
  readonly neto: Decimal;
}

/**
 * Lo que retiene Mercado Pago de un cobro con tarjeta. El IVA se calcula sobre la
 * comisión: con 3.50 % + 16 %, de $1,000 retiene $35.00 + $5.60 = $40.60 y llegan
 * $959.40. La absorbe el negocio: el cliente paga el precio normal.
 */
export function comisionDeCobro(importe: Decimal, { tasa, iva }: TasaComision): Comision {
  const base = big(fijar(big(importe).times(tasa), DECIMALES_DINERO));
  const impuesto = big(fijar(base.times(iva), DECIMALES_DINERO));
  const total = base.plus(impuesto);
  return {
    base: fijar(base, DECIMALES_DINERO),
    iva: fijar(impuesto, DECIMALES_DINERO),
    total: fijar(total, DECIMALES_DINERO),
    neto: fijar(big(importe).minus(total), DECIMALES_DINERO),
  };
}

/** La tasa que de verdad se descuenta: 3.50 % × 1.16 = 4.06 %. */
export function tasaEfectiva({ tasa, iva }: TasaComision): Decimal {
  return fijar(big(tasa).times(big(1).plus(iva)), DECIMALES_PROPORCION);
}

export interface DevolucionDeLinea {
  /** Importe de la línea vendida (ya con su descuento). */
  readonly importe: Decimal;
  readonly cantidadVendida: number;
  /** Piezas y dinero que ya se devolvieron de esta línea antes. */
  readonly devueltasAntes: number;
  readonly reembolsadoAntes: Decimal;
  readonly cantidad: number;
}

/**
 * Cuánto se le regresa al cliente por `cantidad` piezas: la parte proporcional de
 * la línea, descuento incluido. Se calcula sobre el acumulado, así que varias
 * devoluciones parciales suman exacto el importe de la línea, sin centavos de más.
 */
export function reembolsoDeLinea(linea: DevolucionDeLinea): Decimal {
  const acumulado = big(linea.importe)
    .times(linea.devueltasAntes + linea.cantidad)
    .div(linea.cantidadVendida);
  return fijar(
    big(fijar(acumulado, DECIMALES_DINERO)).minus(linea.reembolsadoAntes),
    DECIMALES_DINERO,
  );
}

export interface ComisionDeDevolucion {
  /** Lo que retuvo la entidad al cobrar la venta. */
  readonly comision: Decimal;
  /** Lo que pagó el cliente. */
  readonly total: Decimal;
  /** Reembolsos y comisión ya regresados en devoluciones anteriores. */
  readonly reembolsadoAntes: Decimal;
  readonly devueltaAntes: Decimal;
  /** Lo que se le regresa al cliente en esta devolución. */
  readonly reembolso: Decimal;
}

/**
 * Lo que la entidad regresa de su comisión cuando se le devuelve dinero al
 * cliente desde el cobro original («Devolver dinero» en Mercado Pago): la parte
 * proporcional a lo reembolsado. Sobre el acumulado, para que al devolver todo
 * regrese exacto la comisión completa.
 */
export function comisionDevuelta(devolucion: ComisionDeDevolucion): Decimal {
  if (big(devolucion.total).lte(0)) return fijar(big(0), DECIMALES_DINERO);
  const acumulado = big(devolucion.comision)
    .times(big(devolucion.reembolsadoAntes).plus(devolucion.reembolso))
    .div(devolucion.total);
  return fijar(
    big(fijar(acumulado, DECIMALES_DINERO)).minus(devolucion.devueltaAntes),
    DECIMALES_DINERO,
  );
}

/**
 * Reparte `total` entre varias partes, en proporción a sus `pesos`, **sin perder ni
 * inventar centavos**: la suma de lo repartido es exactamente `total`.
 *
 * Se usa para devolver dinero de una venta cobrada con varios métodos: si pagó $60
 * en efectivo y $40 con tarjeta, un reembolso de $33.33 sale $20.00 y $13.33, no
 * $20.00 y $13.32. Va sobre el acumulado, como `reembolsoDeLinea`, para que el
 * redondeo no se vaya juntando renglón tras renglón.
 *
 * Si todos los pesos son cero (una venta de $0), todo se va a la primera parte.
 */
export function repartirProporcional(total: Decimal, pesos: readonly Decimal[]): Decimal[] {
  if (pesos.length === 0) return [];
  const suma = pesos.reduce((acumulado, peso) => acumulado.plus(peso), big(0));
  if (suma.lte(0)) {
    return pesos.map((_, i) => fijar(i === 0 ? big(total) : big(0), DECIMALES_DINERO));
  }
  let pesoAcumulado = big(0);
  let repartido = big(0);
  return pesos.map((peso) => {
    pesoAcumulado = pesoAcumulado.plus(peso);
    const hastaAqui = big(fijar(big(total).times(pesoAcumulado).div(suma), DECIMALES_DINERO));
    const parte = hastaAqui.minus(repartido);
    repartido = hastaAqui;
    return fijar(parte, DECIMALES_DINERO);
  });
}

/**
 * Lo que gana quien vendió: su tasa sobre lo que quedó **neto de devoluciones**.
 *
 * Se calcula sobre lo neto a propósito: si el cliente regresó la mitad, la mitad de
 * esa venta no se vendió, y la comisión baja sola sin tener que corregirla a mano.
 */
export function comisionDeVendedor(ventaNeta: Decimal, tasa: Decimal): Decimal {
  return fijar(big(ventaNeta).times(tasa), DECIMALES_DINERO);
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
