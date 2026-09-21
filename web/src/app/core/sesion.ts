import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import type { Permiso, Sesion } from '@uvm/compartido';
import { firstValueFrom } from 'rxjs';
import { estadoDeError, mensajeDeError } from './errores';

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'lista'; readonly sesion: Sesion }
  | { readonly tipo: 'error'; readonly mensaje: string; readonly estado: number };

const LLAVE_CORREO_DEV = 'uvm:dev-correo';

/**
 * Quién está usando la app. Se carga una vez al arrancar (`/api/yo`) y de ahí
 * salen el menú y los guards. La API vuelve a revisar cada permiso: esto solo
 * decide qué se muestra.
 */
@Injectable({ providedIn: 'root' })
export class SesionService {
  private readonly http = inject(HttpClient);
  private readonly estado = signal<Estado>({ tipo: 'cargando' });

  readonly sesion = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'lista' ? estado.sesion : null;
  });

  readonly problema = computed(() => {
    const estado = this.estado();
    return estado.tipo === 'error' ? { mensaje: estado.mensaje, estado: estado.estado } : null;
  });

  async cargar(): Promise<void> {
    try {
      const sesion = await firstValueFrom(this.http.get<Sesion>('/api/yo'));
      this.estado.set({ tipo: 'lista', sesion });
    } catch (error) {
      this.estado.set({
        tipo: 'error',
        mensaje: mensajeDeError(error),
        estado: estadoDeError(error),
      });
    }
  }

  /** ¿Tiene al menos uno de estos permisos? */
  puede(...permisos: Permiso[]): boolean {
    const sesion = this.sesion();
    return sesion !== null && permisos.some((permiso) => sesion.permisos.includes(permiso));
  }

  /** Cierra la sesión de Cloudflare Access. */
  salir(): void {
    window.location.assign('/cdn-cgi/access/logout');
  }

  /* ---- solo en modo desarrollo: probar la app como otro usuario ---- */

  static correoDesarrollo(): string | null {
    try {
      return localStorage.getItem(LLAVE_CORREO_DEV);
    } catch {
      return null;
    }
  }

  cambiarUsuarioDesarrollo(correo: string | null): void {
    try {
      if (correo) localStorage.setItem(LLAVE_CORREO_DEV, correo);
      else localStorage.removeItem(LLAVE_CORREO_DEV);
    } catch {
      // Sin almacenamiento no hay cambio de usuario: se queda el de DEV_CORREO.
    }
    window.location.assign('/');
  }
}
