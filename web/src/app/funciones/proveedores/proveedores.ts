import { DecimalPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatTabsModule } from '@angular/material/tabs';
import type { Proveedor, Vehiculo } from '@uvm/compartido';
import { AvisosService } from '../../core/avisos';
import { Desplazable } from '../../ui/desplazable';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { DialogoProveedor, DialogoVehiculo } from './dialogos';

/** Proveedores con su distancia y vehículos con su rendimiento: de ahí sale la gasolina de cada compra. */
@Component({
  selector: 'uvm-proveedores',
  imports: [Desplazable, Encabezado, EstadoCarga, DecimalPipe, MatButtonModule, MatTabsModule],
  templateUrl: './proveedores.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Proveedores {
  private readonly dialogo = inject(MatDialog);
  private readonly avisos = inject(AvisosService);

  protected readonly proveedores = httpResource<Proveedor[]>(() => '/api/proveedores');
  protected readonly vehiculos = httpResource<Vehiculo[]>(() => '/api/vehiculos');

  protected abrirProveedor(proveedor: Proveedor | null): void {
    this.dialogo
      .open<DialogoProveedor, Proveedor | null, Proveedor>(DialogoProveedor, {
        data: proveedor,
        width: '40rem',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.avisos.exito(`${guardado.nombre} guardado.`);
        this.proveedores.reload();
      });
  }

  protected abrirVehiculo(vehiculo: Vehiculo | null): void {
    this.dialogo
      .open<DialogoVehiculo, Vehiculo | null, Vehiculo>(DialogoVehiculo, {
        data: vehiculo,
        width: '32rem',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.avisos.exito(`${guardado.nombre} guardado.`);
        this.vehiculos.reload();
      });
  }
}
