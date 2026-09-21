/**
 * Esquema `gestion` de la BD. Los nombres en TypeScript van en camelCase y
 * Drizzle los escribe en snake_case (`casing: 'snake_case'`).
 *
 * Reglas que cuida la propia BD, además de la API:
 * - `existencias.cantidad >= 0`: no se vende lo que no hay, ni con dos ventas a la vez.
 * - Una línea por producto en cada documento: no puede repetirse un renglón.
 * - El slug solo admite a-z, 0-9 y guiones: es la llave con `products.json` del sitio.
 * - Los folios salen del id, nunca del número de fila.
 * - Nada se borra: productos, proveedores, usuarios y ubicaciones se desactivan.
 *
 * Las reglas de permisos (qué puede hacer cada rol de Postgres) y la vista
 * `publico.catalogo` viven en una migración escrita a mano, no aquí.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  CANALES_VENTA,
  ESTADOS_DOCUMENTO,
  METODOS_PAGO,
  MOTIVOS_AJUSTE,
  TIPOS_MOVIMIENTO,
  TIPOS_UBICACION,
} from '@uvm/compartido';

export const gestion = pgSchema('gestion');

export const tipoUbicacion = gestion.enum('tipo_ubicacion', TIPOS_UBICACION);
export const tipoMovimiento = gestion.enum('tipo_movimiento', TIPOS_MOVIMIENTO);
export const motivoAjuste = gestion.enum('motivo_ajuste', MOTIVOS_AJUSTE);
export const canalVenta = gestion.enum('canal_venta', CANALES_VENTA);
export const metodoPago = gestion.enum('metodo_pago', METODOS_PAGO);
export const estadoDocumento = gestion.enum('estado_documento', ESTADOS_DOCUMENTO);

/* ---- piezas comunes ---- */

const id = () => integer().primaryKey().generatedAlwaysAsIdentity();
const ahora = () => timestamp({ withTimezone: true }).notNull().defaultNow();
/** Dinero: importes y precios. */
const dinero = () => numeric({ precision: 12, scale: 2 });
/** Costos unitarios: 0.359375 de gasolina por pieza no cabe en dos decimales. */
const costo = () => numeric({ precision: 14, scale: 6 });
const fecha = () => date({ mode: 'string' });
/** Un doble toque en el celular no duplica el documento: la clave es única. */
const claveIdempotencia = (tabla: string) =>
  uuid().notNull().unique(`${tabla}_clave_idempotencia_unica`);
const folio = (prefijo: string) =>
  text()
    .notNull()
    .generatedAlwaysAs(sql.raw(`'${prefijo}-' || lpad(id::text, 6, '0')`));

/* -----------------------------------------------------------------------------
   Acceso
   -------------------------------------------------------------------------- */

export const usuarios = gestion.table(
  'usuarios',
  {
    id: id(),
    correo: text().notNull().unique(),
    nombre: text().notNull(),
    activo: boolean().notNull().default(true),
    creadoEn: ahora(),
    ultimoAcceso: timestamp({ withTimezone: true }),
  },
  () => [check('usuarios_correo_minusculas', sql`correo = lower(correo)`)],
);

export const roles = gestion.table('roles', {
  id: id(),
  clave: text().notNull().unique(),
  nombre: text().notNull(),
  descripcion: text().notNull().default(''),
});

export const rolPermisos = gestion.table(
  'rol_permisos',
  {
    rolId: integer()
      .notNull()
      .references(() => roles.id),
    permiso: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.rolId, t.permiso] })],
);

export const usuarioRoles = gestion.table(
  'usuario_roles',
  {
    usuarioId: integer()
      .notNull()
      .references(() => usuarios.id),
    rolId: integer()
      .notNull()
      .references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.usuarioId, t.rolId] })],
);

/* -----------------------------------------------------------------------------
   Ubicaciones: el almacén y una por vendedor
   -------------------------------------------------------------------------- */

export const ubicaciones = gestion.table(
  'ubicaciones',
  {
    id: id(),
    nombre: text().notNull().unique(),
    tipo: tipoUbicacion().notNull(),
    /** Solo las de tipo vendedor: la persona que trae esa mercancía. */
    usuarioId: integer()
      .unique('ubicaciones_usuario_unico')
      .references(() => usuarios.id),
    activa: boolean().notNull().default(true),
    creadoEn: ahora(),
  },
  () => [
    check('ubicaciones_vendedor_con_usuario', sql`(tipo = 'vendedor') = (usuario_id is not null)`),
  ],
);

/* -----------------------------------------------------------------------------
   Catálogo
   -------------------------------------------------------------------------- */

export const categorias = gestion.table('categorias', {
  id: id(),
  nombre: text().notNull().unique(),
  orden: integer().notNull().default(0),
  activa: boolean().notNull().default(true),
});

export const productos = gestion.table(
  'productos',
  {
    id: id(),
    /** Llave con el sitio: es el `id` de `products.json` y el segmento de /catalogo/:slug. */
    slug: text().notNull().unique(),
    nombre: text().notNull(),
    categoriaId: integer()
      .notNull()
      .references(() => categorias.id),
    variedad: text().notNull().default(''),
    presentacion: text(),
    /** `null`: sin precio todavía. No se puede vender y el sitio dice "Consulta precio". */
    precioVenta: dinero(),
    /** Proporción sobre el costo: 0.8000 = 80 %. */
    gananciaObjetivo: numeric({ precision: 6, scale: 4 }),
    /** Costo promedio ponderado móvil de toda la empresa. Lo mantiene MovimientosService. */
    costoPromedio: costo().notNull().default('0'),
    stockMinimo: integer().notNull().default(0),
    activo: boolean().notNull().default(true),
    /** Si el sitio lo muestra (vista `publico.catalogo`). */
    publicado: boolean().notNull().default(false),
    creadoEn: ahora(),
    actualizadoEn: ahora(),
  },
  () => [
    check('productos_slug_formato', sql`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('productos_precio_venta', sql`precio_venta >= 0`),
    check('productos_ganancia_objetivo', sql`ganancia_objetivo >= 0`),
    check('productos_costo_promedio', sql`costo_promedio >= 0`),
    check('productos_stock_minimo', sql`stock_minimo >= 0`),
  ],
);

/* -----------------------------------------------------------------------------
   Proveedores y vehículos
   -------------------------------------------------------------------------- */

export const proveedores = gestion.table(
  'proveedores',
  {
    id: id(),
    nombre: text().notNull().unique(),
    contacto: text().notNull().default(''),
    telefono: text().notNull().default(''),
    /** Kilómetros de ida y vuelta desde el almacén. */
    distanciaKm: numeric({ precision: 7, scale: 2 }).notNull().default('0'),
    categoriasQueSurte: text().notNull().default(''),
    notas: text().notNull().default(''),
    activo: boolean().notNull().default(true),
    creadoEn: ahora(),
  },
  () => [check('proveedores_distancia', sql`distancia_km >= 0`)],
);

export const vehiculos = gestion.table(
  'vehiculos',
  {
    id: id(),
    nombre: text().notNull().unique(),
    rendimientoKmL: numeric({ precision: 6, scale: 2 }).notNull(),
    notas: text().notNull().default(''),
    activo: boolean().notNull().default(true),
    creadoEn: ahora(),
  },
  () => [check('vehiculos_rendimiento', sql`rendimiento_km_l > 0`)],
);

/* -----------------------------------------------------------------------------
   Existencias y kardex
   -------------------------------------------------------------------------- */

export const existencias = gestion.table(
  'existencias',
  {
    productoId: integer()
      .notNull()
      .references(() => productos.id),
    ubicacionId: integer()
      .notNull()
      .references(() => ubicaciones.id),
    cantidad: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.productoId, t.ubicacionId] }),
    check('existencias_no_negativas', sql`cantidad >= 0`),
  ],
);

/* -----------------------------------------------------------------------------
   Compras: cada una es un viaje a un proveedor
   -------------------------------------------------------------------------- */

const cancelacion = () => ({
  estado: estadoDocumento().notNull().default('vigente'),
  canceladoEn: timestamp({ withTimezone: true }),
  canceladoPor: integer().references(() => usuarios.id),
  motivoCancelacion: text(),
});

export const compras = gestion.table(
  'compras',
  {
    id: id(),
    folio: folio('C'),
    fecha: fecha().notNull(),
    proveedorId: integer()
      .notNull()
      .references(() => proveedores.id),
    /** Sin vehículo (el proveedor entregó), el traslado vale 0. */
    vehiculoId: integer().references(() => vehiculos.id),
    /** A dónde entró la mercancía. */
    ubicacionId: integer()
      .notNull()
      .references(() => ubicaciones.id),
    /* Copias del día de la compra: si mañana cambia el proveedor o el vehículo, esta no cambia. */
    precioGasolina: numeric({ precision: 8, scale: 2 }),
    distanciaKm: numeric({ precision: 7, scale: 2 }),
    rendimientoKmL: numeric({ precision: 6, scale: 2 }),
    costoTraslado: dinero().notNull(),
    subtotalMercancia: dinero().notNull(),
    total: dinero().notNull(),
    piezas: integer().notNull(),
    notas: text().notNull().default(''),
    usuarioId: integer()
      .notNull()
      .references(() => usuarios.id),
    claveIdempotencia: claveIdempotencia('compras'),
    registradoEn: ahora(),
    ...cancelacion(),
  },
  (t) => [
    check(
      'compras_viaje_completo',
      sql`(vehiculo_id is null) = (precio_gasolina is null)
        and (vehiculo_id is null) = (distancia_km is null)
        and (vehiculo_id is null) = (rendimiento_km_l is null)`,
    ),
    check('compras_cancelacion', sql`(estado = 'cancelado') = (cancelado_en is not null)`),
    index('compras_fecha').on(t.fecha),
  ],
);

export const compraDetalle = gestion.table(
  'compra_detalle',
  {
    id: id(),
    compraId: integer()
      .notNull()
      .references(() => compras.id),
    productoId: integer()
      .notNull()
      .references(() => productos.id),
    cantidad: integer().notNull(),
    costoProveedor: dinero().notNull(),
    costoTrasladoUnitario: costo().notNull(),
    /** Proveedor + traslado: el costo con el que entró la pieza. */
    costoUnitario: costo().notNull(),
  },
  (t) => [
    unique('compra_detalle_producto_unico').on(t.compraId, t.productoId),
    check('compra_detalle_cantidad', sql`cantidad > 0`),
    check('compra_detalle_costo', sql`costo_proveedor >= 0`),
  ],
);

/* -----------------------------------------------------------------------------
   Traspasos (cargar a un vendedor, recibir devoluciones) y ajustes
   -------------------------------------------------------------------------- */

export const traspasos = gestion.table(
  'traspasos',
  {
    id: id(),
    folio: folio('T'),
    fecha: fecha().notNull(),
    origenId: integer()
      .notNull()
      .references(() => ubicaciones.id),
    destinoId: integer()
      .notNull()
      .references(() => ubicaciones.id),
    notas: text().notNull().default(''),
    usuarioId: integer()
      .notNull()
      .references(() => usuarios.id),
    claveIdempotencia: claveIdempotencia('traspasos'),
    registradoEn: ahora(),
  },
  (t) => [
    check('traspasos_origen_destino', sql`origen_id <> destino_id`),
    index('traspasos_fecha').on(t.fecha),
  ],
);

export const traspasoDetalle = gestion.table(
  'traspaso_detalle',
  {
    id: id(),
    traspasoId: integer()
      .notNull()
      .references(() => traspasos.id),
    productoId: integer()
      .notNull()
      .references(() => productos.id),
    cantidad: integer().notNull(),
  },
  (t) => [
    unique('traspaso_detalle_producto_unico').on(t.traspasoId, t.productoId),
    check('traspaso_detalle_cantidad', sql`cantidad > 0`),
  ],
);

export const ajustes = gestion.table(
  'ajustes',
  {
    id: id(),
    folio: folio('A'),
    fecha: fecha().notNull(),
    ubicacionId: integer()
      .notNull()
      .references(() => ubicaciones.id),
    motivo: motivoAjuste().notNull(),
    notas: text().notNull().default(''),
    usuarioId: integer()
      .notNull()
      .references(() => usuarios.id),
    claveIdempotencia: claveIdempotencia('ajustes'),
    registradoEn: ahora(),
  },
  (t) => [index('ajustes_fecha').on(t.fecha)],
);

export const ajusteDetalle = gestion.table(
  'ajuste_detalle',
  {
    id: id(),
    ajusteId: integer()
      .notNull()
      .references(() => ajustes.id),
    productoId: integer()
      .notNull()
      .references(() => productos.id),
    /** Positivo suma, negativo resta. */
    cantidad: integer().notNull(),
    costoUnitario: costo().notNull(),
  },
  (t) => [
    unique('ajuste_detalle_producto_unico').on(t.ajusteId, t.productoId),
    check('ajuste_detalle_cantidad', sql`cantidad <> 0`),
  ],
);

/* -----------------------------------------------------------------------------
   Ventas: se registran al entregar
   -------------------------------------------------------------------------- */

export const ventas = gestion.table(
  'ventas',
  {
    id: id(),
    folio: folio('V'),
    fecha: fecha().notNull(),
    ubicacionId: integer()
      .notNull()
      .references(() => ubicaciones.id),
    vendedorId: integer()
      .notNull()
      .references(() => usuarios.id),
    canal: canalVenta().notNull(),
    metodoPago: metodoPago().notNull(),
    piezas: integer().notNull(),
    /** Lo que pagó el cliente. */
    total: dinero().notNull(),
    /** Lo que retuvo la entidad del cobro con tarjeta. La absorbe el negocio. */
    comision: dinero().notNull().default('0'),
    notas: text().notNull().default(''),
    claveIdempotencia: claveIdempotencia('ventas'),
    registradoEn: ahora(),
    ...cancelacion(),
  },
  (t) => [
    check('ventas_total', sql`total >= 0`),
    check('ventas_comision', sql`comision >= 0 and comision <= total`),
    check('ventas_cancelacion', sql`(estado = 'cancelado') = (cancelado_en is not null)`),
    index('ventas_fecha').on(t.fecha),
    index('ventas_vendedor_fecha').on(t.vendedorId, t.fecha),
    index('ventas_ubicacion_fecha').on(t.ubicacionId, t.fecha),
  ],
);

export const ventaDetalle = gestion.table(
  'venta_detalle',
  {
    id: id(),
    ventaId: integer()
      .notNull()
      .references(() => ventas.id),
    productoId: integer()
      .notNull()
      .references(() => productos.id),
    cantidad: integer().notNull(),
    /** El precio de lista en el momento de la venta. */
    precioUnitario: dinero().notNull(),
    /** Descuento de toda la línea, en pesos. */
    descuento: dinero().notNull().default('0'),
    importe: dinero()
      .notNull()
      .generatedAlwaysAs(sql`cantidad * precio_unitario - descuento`),
    /** Costo promedio en el momento de la venta: la utilidad de esta venta no cambia después. */
    costoUnitario: costo().notNull(),
  },
  (t) => [
    unique('venta_detalle_producto_unico').on(t.ventaId, t.productoId),
    check('venta_detalle_cantidad', sql`cantidad > 0`),
    check('venta_detalle_precio', sql`precio_unitario >= 0`),
    check(
      'venta_detalle_descuento',
      sql`descuento >= 0 and descuento <= cantidad * precio_unitario`,
    ),
  ],
);

/* -----------------------------------------------------------------------------
   Devoluciones de clientes: piezas de una venta que regresan, con su reembolso
   -------------------------------------------------------------------------- */

export const devoluciones = gestion.table(
  'devoluciones',
  {
    id: id(),
    folio: folio('D'),
    fecha: fecha().notNull(),
    ventaId: integer()
      .notNull()
      .references(() => ventas.id),
    motivo: text().notNull(),
    /** Lo que se le regresó al cliente, por el mismo método con que pagó. */
    reembolso: dinero().notNull(),
    usuarioId: integer()
      .notNull()
      .references(() => usuarios.id),
    claveIdempotencia: claveIdempotencia('devoluciones'),
    registradoEn: ahora(),
  },
  (t) => [
    check('devoluciones_reembolso', sql`reembolso >= 0`),
    index('devoluciones_venta').on(t.ventaId),
    index('devoluciones_fecha').on(t.fecha),
  ],
);

export const devolucionDetalle = gestion.table(
  'devolucion_detalle',
  {
    id: id(),
    devolucionId: integer()
      .notNull()
      .references(() => devoluciones.id),
    /** La línea de la venta de la que salen estas piezas. */
    ventaDetalleId: integer()
      .notNull()
      .references(() => ventaDetalle.id),
    productoId: integer()
      .notNull()
      .references(() => productos.id),
    cantidad: integer().notNull(),
    /** true: vuelve a la venta. false: llegó dañado y no suma existencia. */
    regresaAInventario: boolean().notNull(),
    reembolso: dinero().notNull(),
  },
  (t) => [
    unique('devolucion_detalle_linea_unica').on(t.devolucionId, t.ventaDetalleId),
    check('devolucion_detalle_cantidad', sql`cantidad > 0`),
    check('devolucion_detalle_reembolso', sql`reembolso >= 0`),
    index('devolucion_detalle_linea').on(t.ventaDetalleId),
  ],
);

/* -----------------------------------------------------------------------------
   Comisiones de cobro: lo que retiene la entidad por método de pago
   -------------------------------------------------------------------------- */

export const comisionesPago = gestion.table(
  'comisiones_pago',
  {
    metodoPago: metodoPago().primaryKey(),
    /** Proporción sobre el cobro: 0.0350 = 3.50 %. */
    tasa: numeric({ precision: 6, scale: 4 }).notNull(),
    /** IVA sobre la comisión: 0.1600. */
    iva: numeric({ precision: 6, scale: 4 }).notNull(),
    actualizadoEn: ahora(),
  },
  () => [
    check('comisiones_pago_tasa', sql`tasa >= 0 and tasa < 1`),
    check('comisiones_pago_iva', sql`iva >= 0 and iva < 1`),
  ],
);

/* -----------------------------------------------------------------------------
   Movimientos (kardex): el historial de cada pieza. Solo se agregan filas.
   -------------------------------------------------------------------------- */

export const movimientos = gestion.table(
  'movimientos',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    fecha: fecha().notNull(),
    registradoEn: ahora(),
    productoId: integer()
      .notNull()
      .references(() => productos.id),
    ubicacionId: integer()
      .notNull()
      .references(() => ubicaciones.id),
    tipo: tipoMovimiento().notNull(),
    /** Con signo: positivo entra, negativo sale. */
    cantidad: integer().notNull(),
    costoUnitario: costo().notNull(),
    /** Existencia de esa ubicación después del movimiento. */
    existenciaResultante: integer().notNull(),
    costoPromedioResultante: costo().notNull(),
    usuarioId: integer()
      .notNull()
      .references(() => usuarios.id),
    compraId: integer().references(() => compras.id),
    ventaId: integer().references(() => ventas.id),
    traspasoId: integer().references(() => traspasos.id),
    ajusteId: integer().references(() => ajustes.id),
    devolucionId: integer().references(() => devoluciones.id),
  },
  (t) => [
    check('movimientos_cantidad', sql`cantidad <> 0`),
    check(
      'movimientos_un_documento',
      sql`num_nonnulls(compra_id, venta_id, traspaso_id, ajuste_id, devolucion_id) = 1`,
    ),
    index('movimientos_producto').on(t.productoId, t.id),
    index('movimientos_ubicacion_producto').on(t.ubicacionId, t.productoId, t.id),
    index('movimientos_fecha').on(t.fecha),
    index('movimientos_compra').on(t.compraId),
    index('movimientos_venta').on(t.ventaId),
  ],
);

/* -----------------------------------------------------------------------------
   Bitácora: cambios de precio y de roles, cancelaciones. Solo se agregan filas.
   -------------------------------------------------------------------------- */

export const bitacora = gestion.table(
  'bitacora',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    registradoEn: ahora(),
    usuarioId: integer().references(() => usuarios.id),
    accion: text().notNull(),
    entidad: text().notNull(),
    entidadId: text().notNull(),
    datos: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [index('bitacora_entidad').on(t.entidad, t.entidadId)],
);

/* -----------------------------------------------------------------------------
   Vista: cada línea de venta ya neta de devoluciones y con su parte de comisión.
   La crea a mano la migración 0003; Drizzle solo la consulta.
   -------------------------------------------------------------------------- */

export const ventaLineasNetas = gestion
  .view('venta_lineas_netas', {
    id: integer().notNull(),
    ventaId: integer().notNull(),
    productoId: integer().notNull(),
    cantidad: integer().notNull(),
    importe: dinero().notNull(),
    costoUnitario: costo().notNull(),
    devueltas: integer().notNull(),
    regresadas: integer().notNull(),
    reembolsado: dinero().notNull(),
    piezasNetas: integer().notNull(),
    importeNeto: dinero().notNull(),
    costoNeto: costo().notNull(),
    comision: dinero().notNull(),
  })
  .existing();
