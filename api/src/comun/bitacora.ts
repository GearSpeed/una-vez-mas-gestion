import type { Ejecutor } from '../db/conexion.js';
import { bitacora } from '../db/esquema.js';

export interface EntradaBitacora {
  readonly usuarioId: number | null;
  /** "cambiar_precio", "cancelar", "asignar_roles"… */
  readonly accion: string;
  readonly entidad: string;
  readonly entidadId: string | number;
  readonly datos?: Record<string, unknown>;
}

/** Deja constancia de un cambio sensible. Va dentro de la misma transacción. */
export async function registrarEnBitacora(db: Ejecutor, entrada: EntradaBitacora): Promise<void> {
  await db.insert(bitacora).values({
    usuarioId: entrada.usuarioId,
    accion: entrada.accion,
    entidad: entrada.entidad,
    entidadId: String(entrada.entidadId),
    datos: entrada.datos ?? {},
  });
}
