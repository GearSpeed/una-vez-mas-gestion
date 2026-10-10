import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/**
 * Descarga un archivo de la API (CSV, Excel). Va por HttpClient (y no con un enlace
 * directo) para que la petición lleve las mismas cabeceras que el resto de la app.
 */
@Injectable({ providedIn: 'root' })
export class DescargasService {
  private readonly http = inject(HttpClient);

  async descargar(url: string, nombre: string): Promise<void> {
    let archivo: Blob;
    try {
      archivo = await firstValueFrom(this.http.get(url, { responseType: 'blob' }));
    } catch (error) {
      throw await conCuerpoLegible(error);
    }
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(archivo);
    enlace.download = nombre;
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
  }
}

/**
 * Al pedir un archivo, un error de la API (422, 429…) también llega como Blob: se lee
 * para que `mensajeDeError` muestre el mensaje en español y no un código.
 */
async function conCuerpoLegible(error: unknown): Promise<unknown> {
  if (!(error instanceof HttpErrorResponse) || !(error.error instanceof Blob)) return error;
  try {
    const cuerpo: unknown = JSON.parse(await error.error.text());
    return new HttpErrorResponse({
      error: cuerpo,
      headers: error.headers,
      status: error.status,
      statusText: error.statusText,
      url: error.url ?? undefined,
    });
  } catch {
    return error;
  }
}
