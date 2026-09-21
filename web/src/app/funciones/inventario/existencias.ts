import { CurrencyPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { type ExistenciasRespuesta, normalizar, type Ubicacion } from '@uvm/compartido';
import { conParametros } from '../../core/api';
import { SesionService } from '../../core/sesion';
import { Desplazable } from '../../ui/desplazable';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';

/** Cuánto hay de cada producto: en una ubicación o en todas. El vendedor ve solo lo que trae. */
@Component({
  selector: 'uvm-existencias',
  imports: [
    Desplazable,
    Encabezado,
    EstadoCarga,
    CurrencyPipe,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './existencias.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Existencias {
  private readonly sesion = inject(SesionService);

  protected readonly verTodo = computed(() => this.sesion.puede('inventario.ver_todo'));
  protected readonly titulo = computed(() => (this.verTodo() ? 'Existencias' : 'Mi mercancía'));

  protected readonly ubicacionId = signal<number | null>(null);
  protected readonly busqueda = signal('');
  protected readonly soloConPiezas = signal(false);

  protected readonly ubicaciones = httpResource<Ubicacion[]>(() =>
    this.verTodo() ? '/api/ubicaciones' : undefined,
  );
  protected readonly existencias = httpResource<ExistenciasRespuesta>(() =>
    conParametros('/inventario/existencias', {
      ubicacionId: this.verTodo() ? this.ubicacionId() : null,
    }),
  );

  protected readonly filas = computed(() => {
    const q = normalizar(this.busqueda());
    return (this.existencias.value()?.filas ?? []).filter(
      (f) =>
        (!this.soloConPiezas() || f.cantidad > 0) &&
        (!q || normalizar(`${f.producto} ${f.categoria}`).includes(q)),
    );
  });
  protected readonly totalPiezas = computed(() =>
    this.filas().reduce((suma, f) => suma + f.cantidad, 0),
  );
  /** El mínimo es de toda la empresa: solo se compara contra la suma de todas las ubicaciones. */
  protected readonly vistaTotal = computed(() => this.existencias.value()?.ubicacion === null);
}
