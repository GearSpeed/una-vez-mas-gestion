import { CurrencyPipe, DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import type { Corte, Permiso, Tablero } from '@uvm/compartido';
import { SesionService } from '../../core/sesion';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';

interface Acceso {
  readonly etiqueta: string;
  readonly ruta: string;
  readonly icono: string;
  readonly permisos: readonly Permiso[];
}

const ACCESOS: readonly Acceso[] = [
  {
    etiqueta: 'Registrar una venta',
    ruta: '/ventas/nueva',
    icono: 'point_of_sale',
    permisos: ['ventas.registrar'],
  },
  {
    etiqueta: 'Registrar una compra',
    ruta: '/compras/nueva',
    icono: 'local_shipping',
    permisos: ['compras.registrar'],
  },
  {
    etiqueta: 'Cargar o recibir mercancía',
    ruta: '/inventario/traspasos',
    icono: 'swap_horiz',
    permisos: ['traspasos.registrar'],
  },
  {
    etiqueta: 'Contar o ajustar',
    ruta: '/inventario/ajustes',
    icono: 'rule',
    permisos: ['ajustes.registrar'],
  },
  { etiqueta: 'Precios', ruta: '/productos', icono: 'sell', permisos: ['productos.gestionar'] },
];

@Component({
  selector: 'uvm-inicio',
  imports: [
    Encabezado,
    EstadoCarga,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    CurrencyPipe,
    DatePipe,
  ],
  templateUrl: './inicio.html',
  styleUrl: './inicio.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Inicio {
  private readonly sesion = inject(SesionService);

  protected readonly saludo = computed(() => `Hola, ${this.sesion.sesion()?.nombre ?? ''}`);
  protected readonly accesos = computed(() =>
    ACCESOS.filter((a) => this.sesion.puede(...a.permisos)),
  );
  protected readonly verTablero = computed(() => this.sesion.puede('reportes.ver'));
  protected readonly esVendedor = computed(
    () =>
      this.sesion.puede('ventas.registrar') &&
      !this.verTablero() &&
      this.sesion.sesion()?.ubicacion !== null,
  );

  protected readonly tablero = httpResource<Tablero>(() =>
    this.verTablero() ? '/api/reportes/tablero' : undefined,
  );
  protected readonly corte = httpResource<Corte>(() =>
    this.esVendedor() ? '/api/reportes/corte' : undefined,
  );

  protected readonly piezasQueTrae = computed(() =>
    (this.corte.value()?.productos ?? []).reduce((suma, p) => suma + p.trae, 0),
  );
}
