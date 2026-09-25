import { CurrencyPipe, DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import type { AjusteDetalle, TraspasoDetalle } from '@uvm/compartido';
import { EstadoCarga } from '../../ui/estado-carga';
import { EtiquetaPipe } from '../../ui/etiqueta.pipe';

export interface DatosDialogoDocumento {
  readonly clase: 'traspaso' | 'ajuste';
  readonly id: number;
}

/**
 * Un traspaso o un ajuste, completos: con quién lo hizo, sus piezas y sus notas,
 * que es donde queda escrito el porqué y hasta ahora no había dónde leerlo. Lo
 * abren las listas de inventario y también el kardex, para llegar desde un
 * movimiento al documento que lo causó.
 */
@Component({
  selector: 'uvm-dialogo-documento',
  imports: [CurrencyPipe, DatePipe, EstadoCarga, EtiquetaPipe, MatButtonModule, MatDialogModule],
  templateUrl: './dialogo-documento.html',
  styleUrl: './dialogo-documento.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogoDocumento {
  protected readonly datos = inject<DatosDialogoDocumento>(MAT_DIALOG_DATA);

  protected readonly documento = httpResource<TraspasoDetalle | AjusteDetalle>(
    () =>
      `/api/inventario/${this.datos.clase === 'traspaso' ? 'traspasos' : 'ajustes'}/${this.datos.id}`,
  );

  protected readonly traspaso = computed(() => {
    const documento = this.documento.value();
    return documento && 'origen' in documento ? documento : null;
  });

  protected readonly ajuste = computed(() => {
    const documento = this.documento.value();
    return documento && 'motivo' in documento ? documento : null;
  });
}
