import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { SesionService } from '../../core/sesion';

/** Cuando `/api/yo` falla: correo no dado de alta, Access sin sesión o sin conexión. */
@Component({
  selector: 'uvm-sin-acceso',
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="pagina centro">
      <mat-icon class="icono" aria-hidden="true">{{
        sinConexion() ? 'wifi_off' : 'lock'
      }}</mat-icon>
      <h1>{{ sinConexion() ? 'No hay conexión' : 'Sin acceso' }}</h1>
      <p>{{ mensaje() }}</p>
      <div class="acciones">
        <button mat-flat-button type="button" (click)="reintentar()">Intentar de nuevo</button>
        @if (!sinConexion()) {
          <button mat-button type="button" (click)="sesion.salir()">Entrar con otro correo</button>
        }
      </div>
    </main>
  `,
  styles: `
    .centro {
      justify-items: center;
      text-align: center;
      padding-block: 4rem;
    }
    .icono {
      font-size: 3rem;
      width: 3rem;
      height: 3rem;
      color: var(--mat-sys-primary);
    }
  `,
})
export class SinAcceso {
  protected readonly sesion = inject(SesionService);
  protected readonly sinConexion = computed(() => this.sesion.problema()?.estado === 0);
  protected readonly mensaje = computed(
    () => this.sesion.problema()?.mensaje ?? 'No pudimos confirmar quién eres. Intenta de nuevo.',
  );

  protected reintentar(): void {
    window.location.assign('/');
  }
}
