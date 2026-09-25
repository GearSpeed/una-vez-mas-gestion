/**
 * Forma de lo que responde la API. Todo lo que sea costo, margen o utilidad va
 * dentro de un campo `costos` opcional: la API solo lo incluye si el usuario
 * tiene `costos.ver`, así que a un vendedor ni siquiera le llega la llave.
 */
import type { Decimal } from './calculos.js';
import type {
  CanalVenta,
  Disponibilidad,
  EstadoDocumento,
  MetodoPago,
  MotivoAjuste,
  TipoMovimiento,
  TipoUbicacion,
} from './dominio.js';
import type { Permiso } from './permisos.js';

/* ---- Sesión y usuarios ---- */

export interface UbicacionResumen {
  readonly id: number;
  readonly nombre: string;
  readonly tipo: TipoUbicacion;
}

export interface Sesion {
  readonly id: number;
  readonly correo: string;
  readonly nombre: string;
  readonly roles: readonly { readonly clave: string; readonly nombre: string }[];
  readonly permisos: readonly Permiso[];
  /** La ubicación propia (la del vendedor). `null` si no vende. */
  readonly ubicacion: UbicacionResumen | null;
  /** `true` cuando la API corre sin Cloudflare Access (solo en desarrollo). */
  readonly modoDesarrollo: boolean;
}

export interface Usuario {
  readonly id: number;
  readonly correo: string;
  readonly nombre: string;
  readonly activo: boolean;
  /** Claves de rol. */
  readonly roles: readonly string[];
  readonly ubicacion: UbicacionResumen | null;
  readonly ultimoAcceso: string | null;
}

export interface Rol {
  readonly id: number;
  readonly clave: string;
  readonly nombre: string;
  readonly descripcion: string;
  readonly permisos: readonly Permiso[];
}

export interface Ubicacion extends UbicacionResumen {
  readonly activa: boolean;
  readonly usuarioId: number | null;
  readonly usuarioNombre: string | null;
  /** Piezas que hay en la ubicación, de todos los productos. */
  readonly piezas: number;
}

/* ---- Catálogo ---- */

export interface Categoria {
  readonly id: number;
  readonly nombre: string;
  readonly orden: number;
  readonly activa: boolean;
}

export interface CostosProducto {
  readonly costoPromedio: Decimal;
  readonly gananciaObjetivo: Decimal | null;
  readonly precioSugerido: Decimal | null;
  readonly gananciaPorPieza: Decimal | null;
  readonly gananciaSobreCosto: Decimal | null;
  readonly margenSobrePrecio: Decimal | null;
}

export interface Producto {
  readonly id: number;
  readonly slug: string;
  readonly nombre: string;
  readonly categoriaId: number;
  readonly categoria: string;
  readonly variedad: string;
  readonly presentacion: string | null;
  /** La ficha del sitio: un párrafo. Vacía si no se ha escrito. */
  readonly descripcion: string;
  /** Ingredientes destacados, en orden. Vacío si no se han capturado. */
  readonly ingredientes: readonly string[];
  readonly precioVenta: Decimal | null;
  readonly stockMinimo: number;
  readonly activo: boolean;
  readonly publicado: boolean;
  /** Suma de todas las ubicaciones. */
  readonly existenciaTotal: number;
  /** La foto en el bucket (la misma que muestra el sitio), o `null` si no tiene. */
  readonly imagen: ImagenProducto | null;
  /**
   * El texto alternativo guardado, haya foto o no: se puede escribir antes de subirla
   * y queda esperándola. Cuando sí hay foto, es el mismo que `imagen.alt`.
   */
  readonly imagenAlt: string;
  readonly costos?: CostosProducto;
}

export interface ImagenProducto {
  /** 1200 px de ancho, para el detalle. */
  readonly url: string;
  /** 600 px, para listas y miniaturas. */
  readonly urlChica: string;
  readonly alt: string;
}

export interface Proveedor {
  readonly id: number;
  readonly nombre: string;
  readonly contacto: string;
  readonly telefono: string;
  readonly distanciaKm: Decimal;
  readonly categoriasQueSurte: string;
  readonly notas: string;
  readonly activo: boolean;
}

export interface Vehiculo {
  readonly id: number;
  readonly nombre: string;
  readonly rendimientoKmL: Decimal;
  readonly notas: string;
  readonly activo: boolean;
}

/* ---- Documentos ---- */

export interface Cancelacion {
  readonly en: string;
  readonly por: string;
  readonly motivo: string;
}

export interface Paginado<T> {
  readonly filas: readonly T[];
  readonly total: number;
  readonly pagina: number;
  readonly porPagina: number;
}

export interface CompraResumen {
  readonly id: number;
  readonly folio: string;
  readonly fecha: string;
  readonly proveedor: string;
  readonly vehiculo: string | null;
  readonly ubicacion: string;
  readonly piezas: number;
  readonly costoTraslado: Decimal;
  readonly total: Decimal;
  readonly estado: EstadoDocumento;
  readonly registradaPor: string;
}

export interface LineaCompraDetalle {
  readonly productoId: number;
  readonly producto: string;
  readonly cantidad: number;
  readonly costoProveedor: Decimal;
  readonly costoTrasladoUnitario: Decimal;
  readonly costoUnitario: Decimal;
  readonly importe: Decimal;
}

export interface CompraDetalle extends CompraResumen {
  readonly proveedorId: number;
  readonly vehiculoId: number | null;
  readonly ubicacionId: number;
  readonly precioGasolina: Decimal | null;
  readonly distanciaKm: Decimal | null;
  readonly rendimientoKmL: Decimal | null;
  readonly litros: Decimal | null;
  readonly trasladoPorPieza: Decimal;
  readonly subtotalMercancia: Decimal;
  readonly notas: string;
  readonly registradoEn: string;
  readonly cancelacion: Cancelacion | null;
  readonly lineas: readonly LineaCompraDetalle[];
}

/** Una parte del cobro de una venta: cuánto se pagó con ese método. */
export interface PagoDeVenta {
  readonly metodoPago: MetodoPago;
  readonly importe: Decimal;
  /** Lo que retuvo la entidad por esta parte (solo tarjeta, hoy). */
  readonly comision: Decimal;
}

export interface VentaResumen {
  readonly id: number;
  readonly folio: string;
  readonly fecha: string;
  readonly ubicacion: string;
  readonly vendedor: string;
  readonly canal: CanalVenta;
  /** Cómo pagó: un renglón por método. Uno solo en la mayoría de las ventas. */
  readonly pagos: readonly PagoDeVenta[];
  readonly piezas: number;
  /** Lo que pagó el cliente. */
  readonly total: Decimal;
  /**
   * Lo que se quedó la entidad del cobro con tarjeta (lo absorbe el negocio): lo que
   * retuvo al cobrar menos lo que regresó en devoluciones.
   */
  readonly comision: Decimal;
  /** Lo que se le ha regresado al cliente en devoluciones. */
  readonly reembolsado: Decimal;
  readonly estado: EstadoDocumento;
}

export interface LineaVentaDetalle {
  readonly productoId: number;
  readonly producto: string;
  readonly cantidad: number;
  readonly precioUnitario: Decimal;
  readonly descuento: Decimal;
  readonly importe: Decimal;
  /** Piezas ya devueltas de esta línea. */
  readonly devueltas: number;
  readonly reembolsado: Decimal;
  readonly costos?: { readonly costoUnitario: Decimal };
}

export interface DevolucionResumen {
  readonly id: number;
  readonly folio: string;
  readonly fecha: string;
  readonly motivo: string;
  readonly registradoPor: string;
  readonly reembolso: Decimal;
  /** Lo que la entidad del cobro con tarjeta le regresó al negocio de su comisión. */
  readonly comisionDevuelta: Decimal;
  readonly lineas: readonly {
    readonly productoId: number;
    readonly producto: string;
    readonly cantidad: number;
    readonly regresaAInventario: boolean;
  }[];
}

export interface VentaDetalle extends VentaResumen {
  readonly ubicacionId: number;
  readonly vendedorId: number;
  readonly notas: string;
  readonly registradoEn: string;
  readonly cancelacion: Cancelacion | null;
  readonly lineas: readonly LineaVentaDetalle[];
  readonly devoluciones: readonly DevolucionResumen[];
  /** Costo de lo que se quedó el cliente y utilidad: cobrado − reembolsos − comisión − costo. */
  readonly costos?: { readonly costoTotal: Decimal; readonly utilidad: Decimal };
}

/**
 * Lo único que sale sin identidad: lo que el sitio necesita para su catálogo. Sin
 * costos, sin ids internos y sin la existencia exacta (ver `docs/contrato-sitio.md`).
 */
export interface ProductoPublico {
  readonly slug: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly presentacion: string | null;
  /** La ficha del producto. Cadena vacía si no se ha escrito. */
  readonly descripcion: string;
  /** Ingredientes destacados, en orden. Arreglo vacío si no hay. */
  readonly ingredientes: readonly string[];
  /** `null` = «Consulta precio». */
  readonly precio: Decimal | null;
  readonly disponibilidad: Disponibilidad;
  /** Nunca falta: si el producto no tiene foto, viene el logo (`esPlaceholder`). */
  readonly imagen: ImagenPublica;
}

/** La imagen del catálogo del sitio: siempre hay una, aunque sea de relleno. */
export interface ImagenPublica extends ImagenProducto {
  /** `true` cuando el producto todavía no tiene foto y se está sirviendo el logo. */
  readonly esPlaceholder: boolean;
}

/** Lo que retiene la entidad por cobrar con un método de pago (hoy: tarjeta, Mercado Pago). */
export interface ComisionPago {
  readonly metodoPago: MetodoPago;
  readonly tasa: Decimal;
  readonly iva: Decimal;
  /** tasa × (1 + iva): 0.0406. */
  readonly tasaEfectiva: Decimal;
}

export interface ListaVentas extends Paginado<VentaResumen> {
  /** Totales de las ventas vigentes del filtro (no solo de la página). */
  readonly resumen: {
    /** Cobrado menos reembolsado. */
    readonly importe: Decimal;
    readonly ventas: number;
    /** Por método de pago, ya sin reembolsos. */
    readonly porMetodo: Readonly<Record<MetodoPago, Decimal>>;
    readonly reembolsos: Decimal;
    readonly comisiones: Decimal;
  };
}

export interface TraspasoDetalle {
  readonly id: number;
  readonly folio: string;
  readonly fecha: string;
  readonly origen: string;
  readonly destino: string;
  readonly registradoPor: string;
  readonly notas: string;
  readonly lineas: readonly {
    readonly productoId: number;
    readonly producto: string;
    readonly cantidad: number;
  }[];
}

export interface AjusteDetalle {
  readonly id: number;
  readonly folio: string;
  readonly fecha: string;
  readonly ubicacion: string;
  readonly motivo: MotivoAjuste;
  readonly registradoPor: string;
  readonly notas: string;
  readonly lineas: readonly {
    readonly productoId: number;
    readonly producto: string;
    readonly cantidad: number;
    readonly costos?: { readonly costoUnitario: Decimal };
  }[];
}

/** Resultado de un conteo físico: si no hubo diferencias no se crea ajuste. */
export interface ResultadoConteo {
  readonly diferencias: number;
  readonly ajuste: AjusteDetalle | null;
}

/* ---- Inventario ---- */

export interface Existencia {
  readonly productoId: number;
  readonly slug: string;
  readonly producto: string;
  readonly categoria: string;
  readonly presentacion: string | null;
  readonly precioVenta: Decimal | null;
  readonly activo: boolean;
  readonly cantidad: number;
  readonly stockMinimo: number;
  readonly costos?: { readonly costoPromedio: Decimal; readonly valor: Decimal };
}

export interface ExistenciasRespuesta {
  /** `null` = todas las ubicaciones sumadas. */
  readonly ubicacion: UbicacionResumen | null;
  readonly filas: readonly Existencia[];
  readonly costos?: { readonly valorTotal: Decimal };
}

export interface MovimientoKardex {
  readonly id: number;
  readonly fecha: string;
  readonly registradoEn: string;
  readonly tipo: TipoMovimiento;
  readonly documento: string;
  /** El documento que lo causó, para abrirlo desde el kardex. */
  readonly documentoId: number | null;
  readonly ubicacion: string;
  readonly cantidad: number;
  readonly existenciaResultante: number;
  readonly usuario: string;
  readonly costos?: { readonly costoUnitario: Decimal; readonly costoPromedioResultante: Decimal };
}

/* ---- Gastos de operación ---- */

/** Un gasto que no es mercancía: bolsas, renta, publicidad, una comisión pagada. */
export interface Gasto {
  readonly id: number;
  readonly folio: string;
  readonly fecha: string;
  readonly categoriaId: number;
  readonly categoria: string;
  readonly concepto: string;
  readonly importe: Decimal;
  readonly metodoPago: MetodoPago;
  readonly notas: string;
  readonly registradoPor: string;
  readonly registradoEn: string;
  readonly estado: EstadoDocumento;
  readonly cancelacion: Cancelacion | null;
}

export interface ListaGastos extends Paginado<Gasto> {
  readonly resumen: {
    /** Total de los gastos vigentes del periodo. */
    readonly importe: Decimal;
    readonly porCategoria: readonly { readonly categoria: string; readonly importe: Decimal }[];
  };
}

/* ---- Reportes ---- */

export interface Tablero {
  readonly hoy: string;
  readonly ventas: {
    readonly hoy: ImporteYConteo;
    readonly semana: ImporteYConteo;
    readonly mes: ImporteYConteo;
  };
  readonly bajoMinimo: readonly {
    readonly productoId: number;
    readonly producto: string;
    readonly existencia: number;
    readonly stockMinimo: number;
  }[];
  readonly porUbicacion: readonly { readonly ubicacion: string; readonly piezas: number }[];
  readonly costos?: { readonly utilidadMes: Decimal; readonly valorInventario: Decimal };
}

export interface ImporteYConteo {
  readonly importe: Decimal;
  readonly ventas: number;
}

export interface FilaReporteVentas {
  /** Día, producto, vendedor, canal o método, según el agrupamiento. */
  readonly clave: string;
  readonly etiqueta: string;
  readonly ventas: number;
  readonly piezas: number;
  /** Cobrado menos reembolsado. */
  readonly importe: Decimal;
  readonly costos?: {
    readonly costo: Decimal;
    readonly comision: Decimal;
    readonly utilidad: Decimal;
  };
}

export interface FilaUtilidad {
  readonly productoId: number;
  readonly producto: string;
  readonly piezas: number;
  /** Cobrado menos reembolsado. */
  readonly ingreso: Decimal;
  readonly costo: Decimal;
  /** Parte de la comisión de tarjeta que le toca a este producto. */
  readonly comision: Decimal;
  readonly utilidad: Decimal;
  /** Margen sobre precio del periodo, como proporción. */
  readonly margen: Decimal | null;
}

export interface Corte {
  readonly ubicacion: UbicacionResumen;
  readonly desde: string;
  readonly hasta: string;
  readonly productos: readonly {
    readonly productoId: number;
    readonly producto: string;
    readonly cargo: number;
    readonly vendio: number;
    readonly devolvio: number;
    readonly ajustes: number;
    readonly trae: number;
  }[];
  /** Lo cobrado por las ventas del periodo, por método. */
  readonly cobros: Readonly<Record<MetodoPago, Decimal>>;
  /** Lo regresado a clientes en devoluciones del periodo, por el método con que pagaron. */
  readonly reembolsos: Readonly<Record<MetodoPago, Decimal>>;
  /** Lo que retuvo Mercado Pago de los cobros con tarjeta del periodo. */
  readonly comisiones: Decimal;
  /** Cobros menos reembolsos. */
  readonly totalVendido: Decimal;
}

export interface FilaReporteCompras {
  readonly id: number;
  readonly folio: string;
  readonly fecha: string;
  readonly proveedor: string;
  readonly piezas: number;
  readonly mercancia: Decimal;
  readonly gasolina: Decimal;
  readonly total: Decimal;
}

/* ---- Errores ---- */

/** Cuerpo de todo error de la API. */
export interface ErrorApi {
  readonly mensaje: string;
  /** Errores por campo, con la ruta separada por puntos: "lineas.0.productoId". */
  readonly campos?: Readonly<Record<string, string>>;
}
