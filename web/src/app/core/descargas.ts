import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/**
 * Descarga un CSV de la API. Va por HttpClient (y no con un enlace directo)
 * para que la petición lleve las mismas cabeceras que el resto de la app.
 */
@Injectable({ providedIn: 'root' })
export class DescargasService {
  private readonly http = inject(HttpClient);

  async csv(url: string, nombre: string): Promise<void> {
    const archivo = await firstValueFrom(this.http.get(url, { responseType: 'blob' }));
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(archivo);
    enlace.download = nombre;
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 1000);
  }
}
