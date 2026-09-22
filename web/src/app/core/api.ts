import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/**
 * Escrituras a la API. Las lecturas van con `httpResource` en cada pantalla;
 * aquí solo lo que cambia datos, como promesas para usarlas con async/await.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  post<T>(ruta: string, cuerpo: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(`/api${ruta}`, cuerpo));
  }

  put<T>(ruta: string, cuerpo: unknown): Promise<T> {
    return firstValueFrom(this.http.put<T>(`/api${ruta}`, cuerpo));
  }

  delete<T>(ruta: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>(`/api${ruta}`));
  }
}

/** Query string sin los valores vacíos: `?desde=2026-09-01&pagina=2`. */
export function conParametros(
  ruta: string,
  parametros: Record<string, string | number | null | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor !== null && valor !== undefined && valor !== '') query.set(clave, String(valor));
  }
  const texto = query.toString();
  return texto ? `/api${ruta}?${texto}` : `/api${ruta}`;
}
