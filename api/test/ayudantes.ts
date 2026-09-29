import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configurarApp } from '../src/configurar-app.js';
import { type BaseDatos, crearBaseDatos } from '../src/db/conexion.js';
import { sembrar } from '../src/db/semilla.js';

export const ADMIN = 'admin@prueba.local';
export const ALMACEN = 'almacen@demo.local';
export const ANA = 'ana@demo.local';
export const BETO = 'beto@demo.local';
export const CONSULTA = 'consulta@demo.local';

/** Ids que deja la semilla en una BD recién reiniciada. */
export const IDS = {
  almacen: 1,
  ana: 2,
  beto: 3,
  proveedorDemo: 1,
  motoDemo: 1,
  avena: 1,
  chocolate: 2,
  coco: 3,
  nuez: 4,
  tejocote: 10,
  granola: 11,
  pina: 12,
  canela: 13,
} as const;

export async function crearApp(): Promise<INestApplication> {
  const urls = inject('urlsBd');
  const bucket = inject('bucket');
  Object.assign(process.env, {
    S3_ENDPOINT: bucket.endpoint,
    S3_BUCKET: bucket.bucket,
    S3_ACCESS_KEY: bucket.accessKey,
    S3_SECRET_KEY: bucket.secretKey,
    IMAGENES_URL_PUBLICA: `${bucket.endpoint}/${bucket.bucket}`,
    NODE_ENV: 'test',
    DATABASE_URL: urls.app,
    AUTH_MODO: 'desarrollo',
    DEV_CORREO: ADMIN,
    LOG_NIVEL: 'silent',
  });
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = modulo.createNestApplication<NestExpressApplication>({ logger: false });
  configurarApp(app);
  await app.init();
  return app;
}

/** Deja la BD como recién sembrada (con datos de prueba), con los ids desde 1. */
export async function reiniciarBd(): Promise<void> {
  const owner = conexion('owner');
  try {
    await owner.execute(sql`truncate
      gestion.movimientos, gestion.bitacora, gestion.devolucion_detalle, gestion.devoluciones,
      gestion.venta_detalle, gestion.ventas,
      gestion.compra_detalle, gestion.compras, gestion.traspaso_detalle, gestion.traspasos,
      gestion.ajuste_detalle, gestion.ajustes, gestion.existencias, gestion.productos,
      gestion.gastos, gestion.gasto_categorias,
      gestion.categorias, gestion.proveedores, gestion.vehiculos, gestion.usuario_roles,
      gestion.ubicaciones, gestion.usuarios, gestion.rol_permisos, gestion.roles
      restart identity cascade`);
    await sembrar(owner, { admin: { correo: ADMIN, nombre: 'Admin' }, demo: true });
    // La tarifa de Mercado Pago es configuración: se regresa a la de fábrica.
    await owner.execute(
      sql`update gestion.comisiones_pago set tasa = 0.0350, iva = 0.1600 where metodo_pago = 'tarjeta'`,
    );
  } finally {
    await owner.$client.end();
  }
}

/** Conexión directa con uno de los tres roles de Postgres. */
export function conexion(rol: 'owner' | 'app' | 'sitio'): BaseDatos {
  return crearBaseDatos(inject('urlsBd')[rol], { maximo: 2 });
}

/** Peticiones como un usuario (en modo desarrollo, por X-Dev-Correo). */
export function como(app: INestApplication, correo: string) {
  const http = () => request(app.getHttpServer());
  return {
    get: (ruta: string) => http().get(`/api${ruta}`).set('X-Dev-Correo', correo),
    post: (ruta: string, cuerpo: object = {}) =>
      http().post(`/api${ruta}`).set('X-Dev-Correo', correo).send(cuerpo),
    put: (ruta: string, cuerpo: object) =>
      http().put(`/api${ruta}`).set('X-Dev-Correo', correo).send(cuerpo),
    delete: (ruta: string) => http().delete(`/api${ruta}`).set('X-Dev-Correo', correo),
  };
}

/** Todas las llaves de un JSON, a cualquier profundidad. */
export function llavesDe(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.flatMap(llavesDe);
  if (valor && typeof valor === 'object') {
    return Object.entries(valor).flatMap(([llave, hijo]) => [llave, ...llavesDe(hijo)]);
  }
  return [];
}

let contador = 0;
/** Una clave de idempotencia nueva y válida. */
export function clave(): string {
  contador += 1;
  return `00000000-0000-4000-8000-${String(contador).padStart(12, '0')}`;
}

/** La compra V001 del Excel (con las chispas en una sola línea de 20). */
export function compraV001() {
  return {
    claveIdempotencia: clave(),
    fecha: '2026-09-19',
    proveedorId: IDS.proveedorDemo,
    vehiculoId: IDS.motoDemo,
    precioGasolina: 23,
    lineas: [
      { productoId: IDS.tejocote, cantidad: 10, costoProveedor: 17.55 },
      { productoId: IDS.chocolate, cantidad: 20, costoProveedor: 16.58 },
      { productoId: IDS.granola, cantidad: 10, costoProveedor: 15.6 },
      { productoId: IDS.nuez, cantidad: 10, costoProveedor: 17 },
      { productoId: IDS.avena, cantidad: 10, costoProveedor: 15.6 },
      { productoId: IDS.pina, cantidad: 10, costoProveedor: 17.55 },
      { productoId: IDS.canela, cantidad: 10, costoProveedor: 14.14 },
    ],
  };
}

/** Datos completos de un producto (sin slug: lo pone la API), para un POST o un PUT. */
export function productoConPrecio(nombre: string, precioVenta: number | null, extra: object = {}) {
  return {
    nombre,
    categoriaId: 1,
    variedad: '',
    presentacion: '6 pzas',
    precioVenta,
    gananciaObjetivo: null,
    stockMinimo: 0,
    activo: true,
    publicado: true,
    ...extra,
  };
}
