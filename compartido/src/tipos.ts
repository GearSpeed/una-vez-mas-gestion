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
  TipoCapital,
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
  /** Lo que gana por vender, como proporción: `0.1500` = 15 %. */
  readonly comisionVenta: Decimal;
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

/** Una categoría de gasto: solo agrupa. No sale en el sitio. */
export interface CategoriaGasto {
  readonly id: number;
  readonly nombre: string;
  readonly orden: number;
  readonly activa: boolean;
}

/** Una categoría del catálogo, con la tarjeta que le toca en la portada del sitio. */
export interface Categoria {
  readonly id: number;
  readonly nombre: string;
  readonly orden: number;
  readonly activa: boolean;
  /** «Galletas de Amaranto». Vacío: la tarjeta del sitio usa el `nombre`. */
  readonly titulo: string;
  /** La píldora de la tarjeta: «Tradición dulce». */
  readonly insignia: string;
  /** El ícono de Material Symbols que la acompaña. */
  readonly insigniaIcono: string;
  /** El párrafo de la tarjeta. */
  readonly descripcion: string;
  /** El texto del enlace. Vacío: se arma «Ver {nombre}». */
  readonly cta: string;
  /**
   * Su foto propia, la que manda sobre el sorteo. `null` es lo normal: entonces la
   * tarjeta rota entre las fotos de sus productos.
   */
  readonly imagen: ImagenProducto | null;
  /** El texto alternativo guardado, haya foto o no. */
  readonly imagenAlt: string;
  /**
   * Si dibuja tarjeta en la portada del sitio: tiene descripción y hay de dónde sacar
   * la imagen. Lo calcula la API para que la pantalla no deduzca la regla por su cuenta.
   */
  readonly saleEnPortada: boolean;
  /* Los dos escalones de descuento por volumen. `desde` en cero: sin escalón. */
  readonly descuentoDesde1: number;
  readonly descuentoTasa1: Decimal;
  readonly descuentoDesde2: number;
  readonly descuentoTasa2: Decimal;
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
  /** Lo que se lee en la tarjeta del sitio: una o dos líneas. Vacío si no se ha escrito. */
  readonly resumen: string;
  /** La ficha del sitio: un párrafo. Vacía si no se ha escrito. */
  readonly descripcion: string;
  /** Ingredientes destacados, en orden. Vacío si no se han capturado. */
  readonly ingredientes: readonly string[];
  readonly precioVenta: Decimal | null;
  readonly stockMinimo: number;
  readonly activo: boolean;
  readonly publicado: boolean;
  /** Si sale en «Los Favoritos de la Casa» del sitio. Solo caben cuatro. */
  readonly destacado: boolean;
  /** La píldora de la tarjeta de portada: «Clásico», «Para el café». */
  readonly destacadoEtiqueta: string;
  /** El guiño junto a la estrellita: «El favorito de Ami». */
  readonly destacadoQuip: string;
  /** El texto de la tarjeta. Vacío: el sitio usa el `resumen`. */
  readonly destacadoTexto: string;
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
  /** Con qué se le pagó al proveedor. */
  readonly metodoPago: MetodoPago;
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
 *
 * Las categorías vienen aparte y no deducidas de los productos: una recién dada de alta
 * todavía no tiene ninguno, y el sitio necesita saber que existe para anunciarla.
 */
export interface CatalogoPublico {
  /** Las activas, en el orden en que se muestran. Puede haber alguna sin productos. */
  readonly categorias: readonly CategoriaPublica[];
  readonly productos: readonly ProductoPublico[];
}

export interface CategoriaPublica {
  /** El nombre con el que se filtra el catálogo. Es el `categoria` de cada producto. */
  readonly nombre: string;
  /** Su tarjeta en la portada, o `null` si no tiene foto: sin foto no hay tarjeta. */
  readonly vitrina: VitrinaPublica | null;
}

/** Una tarjeta de «Nuestras Categorías Dulces». El color lo decide el sitio. */
export interface VitrinaPublica {
  /** Ya resuelto: si no se capturó, es el nombre de la categoría. */
  readonly titulo: string;
  /** La píldora: «Tradición dulce». Vacío: el sitio no la pinta. */
  readonly insignia: string;
  /** El ícono de Material Symbols que la acompaña. Vacío: no se pinta. */
  readonly icono: string;
  /** El párrafo de la tarjeta. */
  readonly descripcion: string;
  /** Ya resuelto: si no se capturó, es «Ver {nombre}». */
  readonly cta: string;
  /**
   * Su foto propia, cuando se subió una. **`null` significa «sácala de sus productos»**,
   * que es el caso normal: el sitio sortea entre las fotos de la familia, y así la
   * portada cambia un poco en cada visita.
   */
  readonly imagen: ImagenProducto | null;
}

export interface ProductoPublico {
  readonly slug: string;
  readonly nombre: string;
  readonly categoria: string;
  readonly presentacion: string | null;
  /** Una o dos líneas para la tarjeta del catálogo. Cadena vacía si no se ha escrito. */
  readonly resumen: string;
  /** La ficha del producto. Cadena vacía si no se ha escrito. */
  readonly descripcion: string;
  /** Ingredientes destacados, en orden. Arreglo vacío si no hay. */
  readonly ingredientes: readonly string[];
  /** `null` = «Consulta precio». */
  readonly precio: Decimal | null;
  readonly disponibilidad: Disponibilidad;
  /** Nunca falta: si el producto no tiene foto, viene el logo (`esPlaceholder`). */
  readonly imagen: ImagenPublica;
  /** Los textos de su tarjeta de portada, o `null` si no está en «Los Favoritos». */
  readonly destacado: DestacadoPublico | null;
}

/**
 * Lo que le toca escribir a la portada del sitio. El nombre, la foto, el precio y la
 * disponibilidad no van aquí: esa tarjeta los toma del propio producto.
 */
export interface DestacadoPublico {
  /** La píldora: «Clásico», «Para el café». */
  readonly etiqueta: string;
  /** El guiño junto a la estrellita: «El favorito de Ami». */
  readonly quip: string;
  /** Ya resuelto: si no se capturó, viene el `resumen` del producto. */
  readonly texto: string;
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
  /** Hace falta para el descuento por volumen, que cuenta las piezas por categoría. */
  readonly categoriaId: number;
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
  /** A quién se le pagó, si fue la comisión de una vendedora. */
  readonly vendedor: string | null;
  readonly notas: string;
  readonly registradoPor: string;
  readonly registradoEn: string;
  readonly estado: EstadoDocumento;
  readonly cancelacion: Cancelacion | null;
}

/** Quien pone dinero en el negocio. No es usuario del sistema. */
export interface Socio {
  readonly id: number;
  readonly nombre: string;
  readonly activo: boolean;
  /** Lo que lleva puesto: aportaciones menos retiros, de los movimientos vigentes. */
  readonly saldo: Decimal;
}

/**
 * Dinero que un socio metió o sacó. **No es ingreso ni gasto**: no entra en la utilidad,
 * solo mueve la caja.
 */
export interface MovimientoCapital {
  readonly id: number;
  readonly folio: string;
  readonly fecha: string;
  readonly socioId: number;
  readonly socio: string;
  readonly tipo: TipoCapital;
  readonly concepto: string;
  readonly importe: Decimal;
  readonly metodoPago: MetodoPago;
  readonly notas: string;
  readonly registradoPor: string;
  readonly registradoEn: string;
  readonly estado: EstadoDocumento;
  readonly cancelacion: Cancelacion | null;
}

export interface ListaCapital extends Paginado<MovimientoCapital> {
  readonly resumen: {
    readonly aportaciones: Decimal;
    readonly retiros: Decimal;
    /** Aportaciones menos retiros: lo que los socios llevan puesto en el periodo. */
    readonly neto: Decimal;
  };
  /** Cuánto lleva puesto cada socio, desde siempre. */
  readonly porSocio: readonly { readonly socio: string; readonly saldo: Decimal }[];
}

/**
 * Cuánto dinero debería haber, **acumulado a la fecha** y separado por dónde está: el
 * efectivo no es lo mismo que lo que sigue en Mercado Pago.
 *
 * No es utilidad. Puede haber mucho dinero en caja y el negocio estar perdiendo, si ese
 * dinero lo pusieron los socios.
 */
export interface SaldosCaja {
  readonly bolsas: readonly SaldoBolsa[];
  readonly total: Decimal;
}

export interface SaldoBolsa {
  readonly metodoPago: MetodoPago;
  /** Lo cobrado en ventas; con tarjeta, ya neto de lo que retiene la terminal. */
  readonly ventas: Decimal;
  readonly devoluciones: Decimal;
  readonly compras: Decimal;
  readonly gastos: Decimal;
  readonly aportaciones: Decimal;
  readonly retiros: Decimal;
  readonly saldo: Decimal;
}

export interface ListaGastos extends Paginado<Gasto> {
  readonly resumen: {
    /** Total de los gastos vigentes del periodo. */
    readonly importe: Decimal;
    readonly porCategoria: readonly { readonly categoria: string; readonly importe: Decimal }[];
  };
}

/** Lo que se le debe a quien vende: lo ganado de siempre, menos lo ya pagado. */
export interface ComisionVendedor {
  readonly vendedorId: number;
  readonly vendedor: string;
  /** Su tasa de hoy, para lo que venda de aquí en adelante. */
  readonly tasa: Decimal;
  /** Todo lo que ha ganado, cada venta con la tasa que tenía ese día. */
  readonly ganado: Decimal;
  readonly pagado: Decimal;
  /** Ganado − pagado. Negativo significa que se le pagó de más. */
  readonly saldo: Decimal;
  /** Lo generado dentro del periodo consultado, para explicar el saldo. */
  readonly ganadoEnPeriodo: Decimal;
  readonly pagosEnPeriodo: readonly {
    readonly folio: string;
    readonly fecha: string;
    readonly importe: Decimal;
  }[];
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
  /** Lo que gana quien vendió por estas ventas. Cero si no trabaja por comisión. */
  readonly comisionVendedor: Decimal;
  /** Cobros menos reembolsos. */
  readonly totalVendido: Decimal;
}

/**
 * El resultado del periodo: de lo que se vendió a lo que de verdad quedó.
 *
 * Cuenta **gastos pagados**, no compromisos: por eso las comisiones de quien vende
 * van aparte, como lo que se debe. Cuando se pagan, se registran como gasto y
 * entran en el renglón de gastos del mes en que se pagaron.
 */
export interface EstadoResultados {
  readonly desde: string;
  readonly hasta: string;
  /** Cobrado menos devuelto. */
  readonly ventasNetas: Decimal;
  readonly costoVendido: Decimal;
  readonly utilidadBruta: Decimal;
  /** Lo que se quedó Mercado Pago, ya descontado lo que regresó en devoluciones. */
  readonly comisionTarjeta: Decimal;
  readonly gastos: readonly { readonly categoria: string; readonly importe: Decimal }[];
  readonly totalGastos: Decimal;
  readonly utilidadOperativa: Decimal;
  /** Lo que se le debe a cada quien por vender, y todavía no se le paga. */
  readonly comisionesPorPagar: readonly {
    readonly vendedor: string;
    readonly ventasNetas: Decimal;
    readonly tasa: Decimal;
    readonly comision: Decimal;
  }[];
  /** Dinero atado en mercancía, a costo: ganancia que todavía no es efectivo. */
  readonly valorInventario: Decimal;
  /**
   * Lo que los socios metieron y sacaron en el periodo. **No entra en la
   * utilidad**: es dinero puesto, no ganado. Va aparte para que un mes con
   * pérdida y con aportación no se lea como un mes bueno.
   */
  readonly capitalDelPeriodo: {
    readonly aportaciones: Decimal;
    readonly retiros: Decimal;
    readonly neto: Decimal;
  };
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
