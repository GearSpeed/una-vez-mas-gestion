import { httpResource } from '@angular/common/http';
import { effect, signal } from '@angular/core';

/**
 * Una imagen de una ruta que exige sesión, como URL local (`blob:`). No se puede poner
 * la ruta directo en un `<img>`: se descarga y se suelta al cambiar o al destruirse el
 * componente. Se llama en el contexto de inyección.
 *
 * @param ruta cuál pedir; con null no se hace la petición.
 */
export function imagenConSesion(ruta: () => string | null) {
  const recurso = httpResource.blob(() => ruta() ?? undefined);
  const url = signal<string | null>(null);
  effect((alLimpiar) => {
    const imagen = ruta() ? recurso.value() : undefined;
    if (!imagen) {
      url.set(null);
      return;
    }
    const local = URL.createObjectURL(imagen);
    url.set(local);
    alLimpiar(() => URL.revokeObjectURL(local));
  });
  return { url: url.asReadonly(), recurso };
}
