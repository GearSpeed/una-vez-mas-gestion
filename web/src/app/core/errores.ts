import { HttpErrorResponse } from '@angular/common/http';
import type { AbstractControl } from '@angular/forms';
import type { ErrorApi } from '@uvm/compartido';

/** El mensaje en español que manda la API, o uno claro si ni siquiera hubo respuesta. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0)
      return 'No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.';
    const cuerpo = error.error as Partial<ErrorApi> | null;
    if (cuerpo && typeof cuerpo.mensaje === 'string') return cuerpo.mensaje;
    return `El servidor respondió con un error (${error.status}).`;
  }
  return 'Algo salió mal. Intenta de nuevo.';
}

export function estadoDeError(error: unknown): number {
  return error instanceof HttpErrorResponse ? error.status : 0;
}

/**
 * Marca en el formulario los campos que la API rechazó (422): la ruta
 * "lineas.0.cantidad" es la misma que usa `form.get()`. Devuelve si marcó alguno.
 */
export function marcarErroresDelServidor(formulario: AbstractControl, error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return false;
  const campos = (error.error as Partial<ErrorApi> | null)?.campos;
  if (!campos) return false;
  let marcados = 0;
  for (const [ruta, mensaje] of Object.entries(campos)) {
    const control = formulario.get(ruta);
    if (control) {
      control.setErrors({ ...control.errors, servidor: mensaje });
      control.markAsTouched();
      marcados++;
    }
  }
  return marcados > 0;
}
