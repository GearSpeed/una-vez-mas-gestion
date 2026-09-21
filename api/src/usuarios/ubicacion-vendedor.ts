import { eq } from 'drizzle-orm';
import type { Ejecutor } from '../db/conexion.js';
import { ubicaciones, usuarios } from '../db/esquema.js';

/**
 * Cada vendedor trae su propia mercancía, así que tiene su ubicación. Se crea
 * al asignarle el rol (o se reactiva si ya existía). Si su nombre ya lo usa
 * otra ubicación, se le agrega el correo para distinguirla.
 */
export async function asegurarUbicacionDeVendedor(
  db: Ejecutor,
  usuarioId: number,
): Promise<number> {
  const [existente] = await db
    .select({ id: ubicaciones.id, activa: ubicaciones.activa })
    .from(ubicaciones)
    .where(eq(ubicaciones.usuarioId, usuarioId));
  if (existente) {
    if (!existente.activa) {
      await db.update(ubicaciones).set({ activa: true }).where(eq(ubicaciones.id, existente.id));
    }
    return existente.id;
  }

  const [usuario] = await db
    .select({ nombre: usuarios.nombre, correo: usuarios.correo })
    .from(usuarios)
    .where(eq(usuarios.id, usuarioId));
  if (!usuario) throw new Error(`No existe el usuario ${usuarioId}`);

  const [ocupado] = await db
    .select({ id: ubicaciones.id })
    .from(ubicaciones)
    .where(eq(ubicaciones.nombre, usuario.nombre));
  const nombre = ocupado ? `${usuario.nombre} (${usuario.correo})` : usuario.nombre;

  const [creada] = await db
    .insert(ubicaciones)
    .values({ nombre, tipo: 'vendedor', usuarioId })
    .returning({ id: ubicaciones.id });
  if (!creada) throw new Error('No se pudo crear la ubicación del vendedor');
  return creada.id;
}
