/**
 * Valores fijos del dominio. La BD los declara como enums de Postgres a partir
 * de estas mismas listas, y el front usa las etiquetas para mostrarlos.
 */

export const TIPOS_UBICACION = ['almacen', 'vendedor'] as const;
export type TipoUbicacion = (typeof TIPOS_UBICACION)[number];

export const TIPOS_MOVIMIENTO = [
  'compra',
  'venta',
  'traspaso_salida',
  'traspaso_entrada',
  'ajuste',
  'cancelacion_compra',
  'cancelacion_venta',
] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

export const MOTIVOS_AJUSTE = [
  'merma',
  'caducidad',
  'danado',
  'muestra',
  'conteo',
  'otro',
] as const;
export type MotivoAjuste = (typeof MOTIVOS_AJUSTE)[number];

export const CANALES_VENTA = ['whatsapp', 'presencial', 'evento', 'otro'] as const;
export type CanalVenta = (typeof CANALES_VENTA)[number];

export const METODOS_PAGO = ['efectivo', 'transferencia', 'tarjeta', 'otro'] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

export const ESTADOS_DOCUMENTO = ['vigente', 'cancelado'] as const;
export type EstadoDocumento = (typeof ESTADOS_DOCUMENTO)[number];

export const ETIQUETAS_UBICACION: Readonly<Record<TipoUbicacion, string>> = {
  almacen: 'Almacén',
  vendedor: 'Vendedor',
};

export const ETIQUETAS_MOVIMIENTO: Readonly<Record<TipoMovimiento, string>> = {
  compra: 'Compra',
  venta: 'Venta',
  traspaso_salida: 'Traspaso (sale)',
  traspaso_entrada: 'Traspaso (entra)',
  ajuste: 'Ajuste',
  cancelacion_compra: 'Compra cancelada',
  cancelacion_venta: 'Venta cancelada',
};

export const ETIQUETAS_MOTIVO: Readonly<Record<MotivoAjuste, string>> = {
  merma: 'Merma',
  caducidad: 'Caducidad',
  danado: 'Dañado',
  muestra: 'Muestra o degustación',
  conteo: 'Conteo físico',
  otro: 'Otro',
};

export const ETIQUETAS_CANAL: Readonly<Record<CanalVenta, string>> = {
  whatsapp: 'WhatsApp',
  presencial: 'En persona',
  evento: 'Evento',
  otro: 'Otro',
};

export const ETIQUETAS_METODO_PAGO: Readonly<Record<MetodoPago, string>> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

export const ETIQUETAS_ESTADO: Readonly<Record<EstadoDocumento, string>> = {
  vigente: 'Vigente',
  cancelado: 'Cancelado',
};

/** Formato de los slugs: es la llave que une la BD con `products.json` del sitio. */
export const PATRON_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Zona horaria del negocio: define qué es "hoy" y cómo se agrupan los reportes. */
export const ZONA_HORARIA = 'America/Mexico_City';
