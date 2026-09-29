/**
 * Esquemas de validación de lo que entra a la API. La API los aplica a cada
 * petición y el front infiere de aquí los tipos de lo que manda.
 */
import { z } from 'zod';
import { CANALES_VENTA, ESTADOS_DOCUMENTO, METODOS_PAGO, MOTIVOS_AJUSTE } from './dominio.js';

/** Mensajes de Zod en español. La API y el front lo llaman al arrancar. */
export function configurarZodEnEspanol(): void {
  z.config(z.locales.es());
}

/* -----------------------------------------------------------------------------
   Piezas
   -------------------------------------------------------------------------- */

/** Un campo vacío de formulario ("") cuenta como "sin valor". */
function vacioANulo(valor: unknown): unknown {
  return valor === '' || valor === undefined ? null : valor;
}

/**
 * Decimal como texto, con número máximo de decimales. Acepta número o texto
 * porque así llega de un formulario, y siempre sale como texto.
 */
function decimal(decimales: number, { positivo = false } = {}) {
  const patron = new RegExp(`^\\d{1,9}(\\.\\d{1,${decimales}})?$`);
  return z
    .union([z.number(), z.string().trim()])
    .transform((valor) => String(valor))
    .pipe(z.string().regex(patron, `Escribe un número sin signo, con hasta ${decimales} decimales`))
    .refine((valor) => !positivo || Number(valor) > 0, 'Debe ser mayor que cero');
}

const dinero = decimal(2);
const decimalOpcional = (decimales: number) =>
  z.preprocess(vacioANulo, decimal(decimales).nullable()).default(null);

export const esquemaId = z.number().int().positive();
export const esquemaFecha = z.iso.date('Escribe la fecha como AAAA-MM-DD');
const clave = z.uuid('Clave de idempotencia inválida');

const texto = (maximo: number) => z.string().trim().max(maximo);
const requerido = (maximo: number) =>
  z.string().trim().min(1, 'Este campo es obligatorio').max(maximo);
const notas = texto(500).default('');

/** Una sola línea por producto en cada documento: así no se repite un renglón. */
function sinProductosRepetidos(
  lineas: readonly { productoId: number }[],
  campo: string,
  ctx: z.RefinementCtx,
) {
  const vistos = new Set<number>();
  lineas.forEach((linea, i) => {
    if (vistos.has(linea.productoId)) {
      ctx.addIssue({
        code: 'custom',
        path: [campo, i, 'productoId'],
        message: 'Este producto ya está en la lista; ajusta la cantidad de la otra línea',
      });
    }
    vistos.add(linea.productoId);
  });
}

/* -----------------------------------------------------------------------------
   Catálogo
   -------------------------------------------------------------------------- */

export const esquemaCategoria = z.object({
  nombre: requerido(60),
  orden: z.number().int().min(0).default(0),
  activa: z.boolean().default(true),
});

/** El slug no viene aquí: la API lo genera del nombre al crear y ya no cambia. */
export const esquemaProducto = z
  .object({
    nombre: requerido(120),
    categoriaId: esquemaId,
    variedad: texto(80).default(''),
    presentacion: z.preprocess(vacioANulo, texto(80).nullable()).default(null),
    /** Lo que se lee en la tarjeta del sitio: una o dos líneas. Vacío: la tarjeta no lo pinta. */
    resumen: texto(160).default(''),
    /** La ficha que muestra el sitio. Vacía: el sitio no la pinta. */
    descripcion: texto(1000).default(''),
    /** Ingredientes destacados, en el orden en que se capturaron. */
    ingredientes: z
      .array(texto(40).min(1, 'Escribe el ingrediente'))
      .max(12, 'Como máximo 12 ingredientes')
      .default([]),
    /** `null` = todavía sin precio: el sitio dice "Consulta precio" y no se puede vender. */
    precioVenta: decimalOpcional(2),
    /** Proporción sobre el costo: 0.8 = 80 %. */
    gananciaObjetivo: decimalOpcional(4),
    stockMinimo: z.number().int().min(0).default(0),
    activo: z.boolean().default(true),
    publicado: z.boolean().default(false),
    /** Si sale en «Los Favoritos de la Casa» del sitio. Hay tope de cuatro: lo cuida la API. */
    destacado: z.boolean().default(false),
    /** La píldora de la tarjeta de portada. */
    destacadoEtiqueta: texto(40).default(''),
    /** El guiño junto a la estrellita. */
    destacadoQuip: texto(60).default(''),
    /** El texto de la tarjeta. Vacío: el sitio usa el `resumen` del producto. */
    destacadoTexto: texto(160).default(''),
  })
  .superRefine((producto, ctx) => {
    // Una tarjeta de portada sin píldora ni guiño se ve a medio hacer, y esos dos no se
    // pueden deducir de nada. El texto sí: si falta, el sitio usa el resumen.
    if (!producto.destacado) return;
    if (!producto.destacadoEtiqueta) {
      ctx.addIssue({
        code: 'custom',
        path: ['destacadoEtiqueta'],
        message: 'Escribe la etiqueta de la tarjeta («Clásico», «Para el café»…)',
      });
    }
    if (!producto.destacadoQuip) {
      ctx.addIssue({
        code: 'custom',
        path: ['destacadoQuip'],
        message: 'Escribe el guiño de la tarjeta («El favorito de Ami»…)',
      });
    }
  });

/** El texto alternativo de la foto: lo leen los lectores de pantalla y los buscadores. */
export const esquemaImagenProducto = z.object({
  alt: z
    .string()
    .trim()
    .min(3, 'Describe la imagen en pocas palabras')
    .max(200, 'Máximo 200 caracteres'),
});

export const esquemaProveedor = z.object({
  nombre: requerido(120),
  contacto: texto(120).default(''),
  telefono: texto(40).default(''),
  /** Kilómetros de ida y vuelta. */
  distanciaKm: decimal(2),
  categoriasQueSurte: texto(200).default(''),
  notas,
  activo: z.boolean().default(true),
});

export const esquemaVehiculo = z.object({
  nombre: requerido(80),
  rendimientoKmL: decimal(2, { positivo: true }),
  notas,
  activo: z.boolean().default(true),
});

/* -----------------------------------------------------------------------------
   Compras
   -------------------------------------------------------------------------- */

export const esquemaNuevaCompra = z
  .object({
    claveIdempotencia: clave,
    fecha: esquemaFecha,
    proveedorId: esquemaId,
    /** Sin vehículo (el proveedor entregó), el traslado vale 0. */
    vehiculoId: esquemaId.nullable().default(null),
    /** Sin ubicación, la compra entra al almacén principal. */
    ubicacionId: esquemaId.nullable().default(null),
    precioGasolina: decimalOpcional(2),
    /** Sin distancia se usa la del proveedor. */
    distanciaKm: decimalOpcional(2),
    notas,
    lineas: z
      .array(
        z.object({
          productoId: esquemaId,
          cantidad: z.number().int().positive().max(100_000),
          costoProveedor: dinero,
        }),
      )
      .min(1, 'Agrega al menos un producto')
      .max(200),
  })
  .superRefine((compra, ctx) => {
    if (
      compra.vehiculoId !== null &&
      (compra.precioGasolina === null || Number(compra.precioGasolina) <= 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['precioGasolina'],
        message: 'Indica el precio de la gasolina de ese día',
      });
    }
    sinProductosRepetidos(compra.lineas, 'lineas', ctx);
  });

/**
 * Devolución de piezas de una venta. Por cada producto se dice si vuelve a la
 * venta (regresa al inventario) o si llegó dañado (no suma existencia).
 */
export const esquemaDevolucion = z
  .object({
    claveIdempotencia: clave,
    fecha: esquemaFecha.optional(),
    motivo: z.string().trim().min(3, 'Escribe el motivo').max(300),
    lineas: z
      .array(
        z.object({
          productoId: esquemaId,
          cantidad: z.number().int().positive().max(10_000),
          regresaAInventario: z.boolean().default(true),
        }),
      )
      .min(1, 'Elige al menos un producto')
      .max(100),
  })
  .superRefine((devolucion, ctx) => sinProductosRepetidos(devolucion.lineas, 'lineas', ctx));

/** Tasas de lo que retiene la entidad del cobro, como proporción (0.035 = 3.5 %). */
export const esquemaComision = z.object({
  tasa: decimal(4).refine((valor) => Number(valor) < 1, 'Debe ser menor a 100 %'),
  iva: decimal(4).refine((valor) => Number(valor) < 1, 'Debe ser menor a 100 %'),
});

export const esquemaCancelacion = z.object({
  motivo: z.string().trim().min(3, 'Escribe el motivo').max(300),
});

/* -----------------------------------------------------------------------------
   Inventario
   -------------------------------------------------------------------------- */

export const esquemaNuevoTraspaso = z
  .object({
    claveIdempotencia: clave,
    fecha: esquemaFecha.optional(),
    origenId: esquemaId,
    destinoId: esquemaId,
    notas,
    lineas: z
      .array(
        z.object({ productoId: esquemaId, cantidad: z.number().int().positive().max(100_000) }),
      )
      .min(1, 'Agrega al menos un producto')
      .max(200),
  })
  .superRefine((traspaso, ctx) => {
    if (traspaso.origenId === traspaso.destinoId) {
      ctx.addIssue({
        code: 'custom',
        path: ['destinoId'],
        message: 'El destino debe ser otra ubicación',
      });
    }
    sinProductosRepetidos(traspaso.lineas, 'lineas', ctx);
  });

export const esquemaNuevoAjuste = z
  .object({
    claveIdempotencia: clave,
    fecha: esquemaFecha.optional(),
    ubicacionId: esquemaId,
    motivo: z.enum(MOTIVOS_AJUSTE),
    notas,
    lineas: z
      .array(
        z.object({
          productoId: esquemaId,
          /** Positivo suma, negativo resta. */
          cantidad: z
            .number()
            .int()
            .min(-100_000)
            .max(100_000)
            .refine((n) => n !== 0, 'La cantidad no puede ser cero'),
          /** Solo para las que suman; sin él se usa el costo promedio. */
          costoUnitario: decimalOpcional(6),
        }),
      )
      .min(1, 'Agrega al menos un producto')
      .max(200),
  })
  .superRefine((ajuste, ctx) => sinProductosRepetidos(ajuste.lineas, 'lineas', ctx));

export const esquemaConteo = z
  .object({
    claveIdempotencia: clave,
    fecha: esquemaFecha.optional(),
    ubicacionId: esquemaId,
    notas,
    conteos: z
      .array(z.object({ productoId: esquemaId, contado: z.number().int().min(0).max(100_000) }))
      .min(1, 'Captura al menos un producto')
      .max(500),
  })
  .superRefine((conteo, ctx) => sinProductosRepetidos(conteo.conteos, 'conteos', ctx));

/* -----------------------------------------------------------------------------
   Ventas
   -------------------------------------------------------------------------- */

export const esquemaNuevaVenta = z
  .object({
    claveIdempotencia: clave,
    fecha: esquemaFecha.optional(),
    /** Solo quien tiene `ventas.cualquier_ubicacion` puede elegirla. */
    ubicacionId: esquemaId.optional(),
    canal: z.enum(CANALES_VENTA),
    /**
     * Cómo pagó: un renglón por método. Lo normal es uno solo; si el cliente paga
     * una parte en efectivo y otra con tarjeta, van dos. Que la suma cuadre con el
     * total lo revisa la API, que es quien conoce los precios.
     */
    pagos: z
      .array(z.object({ metodoPago: z.enum(METODOS_PAGO), importe: dinero }))
      .min(1, 'Falta decir cómo pagó')
      .max(METODOS_PAGO.length)
      .refine(
        (pagos) => new Set(pagos.map((p) => p.metodoPago)).size === pagos.length,
        'No repitas el mismo método de pago',
      ),
    notas,
    lineas: z
      .array(
        z.object({
          productoId: esquemaId,
          cantidad: z.number().int().positive().max(10_000),
          /** Descuento de toda la línea, en pesos. */
          descuento: dinero.default('0'),
        }),
      )
      .min(1, 'Agrega al menos un producto')
      .max(100),
  })
  .superRefine((venta, ctx) => sinProductosRepetidos(venta.lineas, 'lineas', ctx));

/* -----------------------------------------------------------------------------
   Gastos de operación
   -------------------------------------------------------------------------- */

/** Las categorías de gasto tienen la misma forma que las de producto. */
export const esquemaCategoriaGasto = esquemaCategoria;

export const esquemaGasto = z.object({
  claveIdempotencia: clave,
  fecha: esquemaFecha.optional(),
  categoriaId: esquemaId,
  /** Qué se compró o se pagó: «Bolsas de celofán», «Comisión de Ana de septiembre». */
  concepto: requerido(200),
  importe: dinero,
  metodoPago: z.enum(METODOS_PAGO),
  /** A quién se le pagó, si el gasto es la comisión de una vendedora. */
  vendedorId: z.preprocess(vacioANulo, esquemaId.nullable()).default(null),
  notas,
});

/* -----------------------------------------------------------------------------
   Usuarios y ubicaciones
   -------------------------------------------------------------------------- */

export const esquemaUsuario = z.object({
  correo: z.string().trim().toLowerCase().pipe(z.email('Escribe un correo válido')),
  nombre: requerido(120),
  activo: z.boolean().default(true),
  roles: z.array(z.string().min(1).max(60)).min(1, 'Elige al menos un rol').max(20),
  /** Lo que gana por vender, como proporción: 0.15 = 15 %. Cero si no es por comisión. */
  comisionVenta: decimal(4)
    .refine((valor) => Number(valor) <= 1, 'No puede pasar del 100 %')
    .default('0'),
});

export const esquemaUbicacion = z.object({
  nombre: requerido(80),
  activa: z.boolean().default(true),
});

/* -----------------------------------------------------------------------------
   Filtros (llegan como query string)
   -------------------------------------------------------------------------- */

const idEnQuery = z.coerce.number().int().positive().optional();

export const esquemaPeriodo = z.object({
  desde: esquemaFecha.optional(),
  hasta: esquemaFecha.optional(),
});

// Con tope: un OFFSET enorme hace que Postgres recorra el índice entero para nada.
const pagina = z.coerce.number().int().min(1).max(10_000).default(1);

export const esquemaFiltroVentas = esquemaPeriodo.extend({
  vendedorId: idEnQuery,
  ubicacionId: idEnQuery,
  estado: z.enum(ESTADOS_DOCUMENTO).optional(),
  pagina,
});

export const esquemaFiltroGastos = esquemaPeriodo.extend({
  categoriaId: idEnQuery,
  estado: z.enum(ESTADOS_DOCUMENTO).optional(),
  pagina,
});

export const esquemaFiltroCompras = esquemaPeriodo.extend({
  proveedorId: idEnQuery,
  estado: z.enum(ESTADOS_DOCUMENTO).optional(),
  pagina,
});

export const esquemaFiltroExistencias = z.object({ ubicacionId: idEnQuery });

export const esquemaFiltroKardex = esquemaPeriodo.extend({
  productoId: z.coerce.number().int().positive(),
  ubicacionId: idEnQuery,
  pagina,
});

export const esquemaFormato = z.object({ formato: z.enum(['json', 'csv']).default('json') });

export const esquemaFiltroReporteVentas = esquemaPeriodo.extend({
  agrupar: z.enum(['dia', 'producto', 'vendedor', 'canal', 'metodo']).default('dia'),
  vendedorId: idEnQuery,
  ubicacionId: idEnQuery,
});

export const esquemaFiltroCorte = esquemaPeriodo.extend({ ubicacionId: idEnQuery });

/* -----------------------------------------------------------------------------
   Tipos que mandan los formularios (entrada) y los que usa la API (salida)
   -------------------------------------------------------------------------- */

export type DatosCategoria = z.output<typeof esquemaCategoria>;
export type DatosGasto = z.output<typeof esquemaGasto>;
export type FiltroGastos = z.output<typeof esquemaFiltroGastos>;
export type DatosProducto = z.output<typeof esquemaProducto>;
export type DatosImagenProducto = z.output<typeof esquemaImagenProducto>;
export type DatosProveedor = z.output<typeof esquemaProveedor>;
export type DatosVehiculo = z.output<typeof esquemaVehiculo>;
export type NuevaCompra = z.output<typeof esquemaNuevaCompra>;
export type NuevoTraspaso = z.output<typeof esquemaNuevoTraspaso>;
export type NuevoAjuste = z.output<typeof esquemaNuevoAjuste>;
export type NuevoConteo = z.output<typeof esquemaConteo>;
export type NuevaVenta = z.output<typeof esquemaNuevaVenta>;
export type NuevaDevolucion = z.output<typeof esquemaDevolucion>;
export type DatosComision = z.output<typeof esquemaComision>;
export type EntradaDevolucion = z.input<typeof esquemaDevolucion>;
export type DatosCancelacion = z.output<typeof esquemaCancelacion>;
export type DatosUsuario = z.output<typeof esquemaUsuario>;
export type DatosUbicacion = z.output<typeof esquemaUbicacion>;
export type Periodo = z.output<typeof esquemaPeriodo>;
export type FiltroVentas = z.output<typeof esquemaFiltroVentas>;
export type FiltroCompras = z.output<typeof esquemaFiltroCompras>;
export type FiltroExistencias = z.output<typeof esquemaFiltroExistencias>;
export type FiltroKardex = z.output<typeof esquemaFiltroKardex>;
export type FiltroReporteVentas = z.output<typeof esquemaFiltroReporteVentas>;
export type FiltroCorte = z.output<typeof esquemaFiltroCorte>;
export type AgruparVentasPor = FiltroReporteVentas['agrupar'];

export type EntradaProducto = z.input<typeof esquemaProducto>;
export type EntradaProveedor = z.input<typeof esquemaProveedor>;
export type EntradaVehiculo = z.input<typeof esquemaVehiculo>;
export type EntradaCompra = z.input<typeof esquemaNuevaCompra>;
export type EntradaTraspaso = z.input<typeof esquemaNuevoTraspaso>;
export type EntradaAjuste = z.input<typeof esquemaNuevoAjuste>;
export type EntradaConteo = z.input<typeof esquemaConteo>;
export type EntradaVenta = z.input<typeof esquemaNuevaVenta>;
export type EntradaUsuario = z.input<typeof esquemaUsuario>;
export type EntradaUbicacion = z.input<typeof esquemaUbicacion>;
