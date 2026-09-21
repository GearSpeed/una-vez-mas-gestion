import type { UsuarioSesion } from '../acceso/usuario-sesion.js';

/**
 * Agrega el bloque `costos` solo si el usuario tiene `costos.ver`. Sin el
 * permiso la llave ni siquiera viaja: el filtro lo hace la API, no la pantalla.
 */
export function conCostos<T extends object, C>(
  usuario: UsuarioSesion,
  base: T,
  costos: () => C,
): T & { costos?: C } {
  return usuario.puede('costos.ver') ? { ...base, costos: costos() } : base;
}
