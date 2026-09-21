import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { Encabezado } from '../../ui/encabezado';

@Component({
  selector: 'uvm-no-encontrada',
  imports: [Encabezado, MatButtonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pagina">
      <uvm-encabezado titulo="No encontramos esta página" />
      <p>Puede que el enlace esté incompleto o que la página ya no exista.</p>
      <p><a mat-flat-button routerLink="/">Ir al inicio</a></p>
    </div>
  `,
})
export class NoEncontrada {}
