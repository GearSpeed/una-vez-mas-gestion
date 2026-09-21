import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

/** Avisos breves al pie. Material los anuncia a los lectores de pantalla. */
@Injectable({ providedIn: 'root' })
export class AvisosService {
  private readonly snackBar = inject(MatSnackBar);

  exito(mensaje: string): void {
    this.snackBar.open(mensaje, 'Cerrar', { duration: 6000, politeness: 'polite' });
  }

  error(mensaje: string): void {
    this.snackBar.open(mensaje, 'Cerrar', { duration: 10000, politeness: 'assertive' });
  }
}
