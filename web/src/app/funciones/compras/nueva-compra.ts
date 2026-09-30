import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import {
  calcularCompra,
  type CompraDetalle,
  fechaDeHoy,
  METODOS_PAGO,
  type MetodoPago,
  type Producto,
  type Proveedor,
  type Ubicacion,
  type Vehiculo,
  type Viaje,
} from '@uvm/compartido';
import { startWith } from 'rxjs';
import { ApiService } from '../../core/api';
import { AvisosService } from '../../core/avisos';
import { marcarErroresDelServidor, mensajeDeError } from '../../core/errores';
import { nuevaClave, numeroONulo } from '../../ui/claves';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { EtiquetaPipe } from '../../ui/etiqueta.pipe';
import { CALENDARIO_EN_ESPANOL } from '../../ui/intl-calendario';

/**
 * Una compra es un viaje: a quién se le compró, en qué vehículo y a cómo estaba
 * la gasolina. El costo del viaje se reparte entre las piezas mientras se
 * captura, con la misma cuenta que usa la API (y que usaba el Excel).
 */
@Component({
  selector: 'uvm-nueva-compra',
  imports: [
    Encabezado,
    EstadoCarga,
    ReactiveFormsModule,
    RouterLink,
    CurrencyPipe,
    DecimalPipe,
    EtiquetaPipe,
    MatButtonModule,
    MatButtonToggleModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  providers: [CALENDARIO_EN_ESPANOL],
  templateUrl: './nueva-compra.html',
  styleUrl: './nueva-compra.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NuevaCompra {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  private readonly router = inject(Router);

  protected readonly hoy = fechaDeHoy();
  protected readonly proveedores = httpResource<Proveedor[]>(() => '/api/proveedores');
  protected readonly vehiculos = httpResource<Vehiculo[]>(() => '/api/vehiculos');
  protected readonly productos = httpResource<Producto[]>(() => '/api/productos');
  protected readonly ubicaciones = httpResource<Ubicacion[]>(() => '/api/ubicaciones');

  protected readonly proveedoresActivos = computed(() =>
    (this.proveedores.value() ?? []).filter((p) => p.activo),
  );
  protected readonly vehiculosActivos = computed(() =>
    (this.vehiculos.value() ?? []).filter((v) => v.activo),
  );
  protected readonly almacenes = computed(() =>
    (this.ubicaciones.value() ?? []).filter((u) => u.activa && u.tipo === 'almacen'),
  );

  protected readonly metodos = METODOS_PAGO;

  protected readonly formulario = this.fb.group({
    fecha: [fechaDeHoy(), Validators.required],
    proveedorId: this.fb.control<number | null>(null, Validators.required),
    vehiculoId: this.fb.control<number | null>(null),
    precioGasolina: this.fb.control<number | null>(null),
    distanciaKm: this.fb.control<number | null>(null),
    ubicacionId: this.fb.control<number | null>(null),
    metodoPago: this.fb.control<MetodoPago>('efectivo', Validators.required),
    notas: [''],
    lineas: this.fb.array([this.nuevaLinea()]),
  });
  protected readonly lineas = this.formulario.controls.lineas;

  private readonly valor = toSignal(
    this.formulario.valueChanges.pipe(startWith(this.formulario.getRawValue())),
    { initialValue: this.formulario.getRawValue() },
  );

  /** El mismo cálculo que hará la API al guardar. */
  protected readonly calculo = computed(() => {
    const valor = this.valor();
    const vehiculo = this.vehiculosActivos().find((v) => v.id === valor.vehiculoId);
    const viaje: Viaje | null =
      vehiculo &&
      numeroONulo(valor.precioGasolina) !== null &&
      numeroONulo(valor.distanciaKm) !== null
        ? {
            distanciaKm: String(valor.distanciaKm),
            rendimientoKmL: vehiculo.rendimientoKmL,
            precioGasolina: String(valor.precioGasolina),
          }
        : null;
    const lineas = (valor.lineas ?? []).map((l) => ({
      cantidad: Math.max(0, Math.trunc(numeroONulo(l?.cantidad) ?? 0)),
      costoProveedor: String(Math.max(0, numeroONulo(l?.costoProveedor) ?? 0)),
    }));
    return calcularCompra(viaje, lineas);
  });

  protected readonly enviando = signal(false);
  protected readonly error = signal<string | null>(null);
  private clave = nuevaClave();

  constructor() {
    const alDestruir = takeUntilDestroyed(inject(DestroyRef));

    // Al elegir proveedor se propone su distancia de ida y vuelta.
    this.formulario.controls.proveedorId.valueChanges.pipe(alDestruir).subscribe((id) => {
      const proveedor = this.proveedoresActivos().find((p) => p.id === id);
      if (proveedor) this.formulario.controls.distanciaKm.setValue(Number(proveedor.distanciaKm));
    });

    // Con vehículo, el precio de la gasolina es obligatorio.
    this.formulario.controls.vehiculoId.valueChanges.pipe(alDestruir).subscribe((id) => {
      const gasolina = this.formulario.controls.precioGasolina;
      gasolina.setValidators(id === null ? [] : [Validators.required, Validators.min(0.01)]);
      gasolina.updateValueAndValidity();
    });
  }

  protected agregarLinea(): void {
    this.lineas.push(this.nuevaLinea());
  }

  protected quitarLinea(indice: number): void {
    if (this.lineas.length > 1) this.lineas.removeAt(indice);
  }

  /** Un producto ya elegido en otra línea no se ofrece de nuevo. */
  protected elegidoEnOtraLinea(productoId: number, indice: number): boolean {
    return this.lineas.controls.some(
      (linea, i) => i !== indice && linea.controls.productoId.value === productoId,
    );
  }

  protected async registrar(): Promise<void> {
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid || this.enviando()) {
      this.error.set('Revisa los campos marcados.');
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    const valor = this.formulario.getRawValue();
    try {
      const compra = await this.api.post<CompraDetalle>('/compras', {
        claveIdempotencia: this.clave,
        fecha: valor.fecha,
        proveedorId: valor.proveedorId,
        vehiculoId: valor.vehiculoId,
        precioGasolina: valor.vehiculoId === null ? null : valor.precioGasolina,
        distanciaKm: valor.vehiculoId === null ? null : valor.distanciaKm,
        ubicacionId: valor.ubicacionId,
        metodoPago: valor.metodoPago,
        notas: valor.notas,
        lineas: valor.lineas,
      });
      this.clave = nuevaClave();
      this.avisos.exito(`Compra ${compra.folio} registrada: ${compra.piezas} piezas.`);
      void this.router.navigate(['/compras', compra.id]);
    } catch (error) {
      marcarErroresDelServidor(this.formulario, error);
      this.error.set(mensajeDeError(error));
    } finally {
      this.enviando.set(false);
    }
  }

  private nuevaLinea() {
    return this.fb.group({
      productoId: this.fb.control<number | null>(null, Validators.required),
      cantidad: this.fb.control<number | null>(null, [Validators.required, Validators.min(1)]),
      costoProveedor: this.fb.control<number | null>(null, [
        Validators.required,
        Validators.min(0),
      ]),
    });
  }
}
