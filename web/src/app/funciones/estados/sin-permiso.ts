import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { Encabezado } from '../../ui/encabezado';

@Component({
  selector: 'uvm-sin-permiso',
  imports: [Encabezado, MatButtonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pagina">
      <uvm-encabezado titulo="Sin permiso" />
      <p>
        Tu rol no incluye esta pantalla. Si la necesitas, pídele al administrador que te la asigne.
      </p>
      <p><a mat-flat-button routerLink="/">Ir al inicio</a></p>
    </div>
  `,
})
export class SinPermiso {}
