import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { Rol, Ubicacion, Usuario } from '@uvm/compartido';
import { ApiService } from '../../core/api';
import { marcarErroresDelServidor, mensajeDeError } from '../../core/errores';

export interface DatosDialogoUsuario {
  readonly usuario: Usuario | null;
  readonly roles: readonly Rol[];
}

const IMPORTS = [
  ReactiveFormsModule,
  MatButtonModule,
  MatCheckboxModule,
  MatDialogModule,
  MatFormFieldModule,
  MatInputModule,
];

@Component({
  selector: 'uvm-dialogo-usuario',
  imports: IMPORTS,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ usuario ? 'Editar ' + usuario.nombre : 'Nuevo usuario' }}</h2>
    <form [formGroup]="formulario" (ngSubmit)="guardar()" novalidate>
      <mat-dialog-content class="contenido">
        <div class="rejilla-campos">
          <mat-form-field>
            <mat-label>Nombre</mat-label>
            <input matInput formControlName="nombre" cdkFocusInitial />
            @if (formulario.controls.nombre.invalid) {
              <mat-error>Escribe el nombre.</mat-error>
            }
          </mat-form-field>
          <mat-form-field>
            <mat-label>Correo</mat-label>
            <input matInput type="email" formControlName="correo" autocomplete="off" />
            <mat-hint>Con este correo entra por Cloudflare Access.</mat-hint>
            @if (formulario.controls.correo.invalid) {
              <mat-error>{{
                formulario.controls.correo.getError('servidor') ?? 'Escribe un correo válido.'
              }}</mat-error>
            }
          </mat-form-field>
        </div>
        <fieldset class="roles">
          <legend>Roles</legend>
          @for (rol of datos.roles; track rol.id) {
            <mat-checkbox
              [checked]="elegidos().has(rol.clave)"
              (change)="alternar(rol.clave, $event.checked)"
            >
              <strong>{{ rol.nombre }}</strong> — {{ rol.descripcion }}
            </mat-checkbox>
          }
          @if (sinRoles()) {
            <p class="error-texto" role="alert">Elige al menos un rol.</p>
          }
        </fieldset>
        <mat-form-field class="comision">
          <mat-label>Comisión por vender</mat-label>
          <input
            matInput
            type="number"
            inputmode="decimal"
            min="0"
            max="100"
            step="1"
            formControlName="comisionPorcentaje"
          />
          <span matTextSuffix>&nbsp;%</span>
          <mat-hint>De lo que venda, ya neto de devoluciones. Cero si no es por comisión.</mat-hint>
        </mat-form-field>
        <mat-checkbox formControlName="activo">Activo (puede entrar)</mat-checkbox>
        <p class="ayuda">
          Recuerda: la persona también debe estar en la política de Cloudflare Access para poder
          abrir la app.
        </p>
        @if (error()) {
          <p class="error-texto" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancelar</button>
        <button mat-flat-button type="submit" [disabled]="guardando()">Guardar</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .contenido {
      display: grid;
      gap: 0.75rem;
    }
    .roles {
      border: 0;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.25rem;
    }
    .comision {
      max-width: 16rem;
    }
    legend {
      font: var(--mat-sys-title-medium);
      padding-bottom: 0.25rem;
    }
  `,
})
export class DialogoUsuario {
  protected readonly datos = inject<DatosDialogoUsuario>(MAT_DIALOG_DATA);
  private readonly referencia = inject<MatDialogRef<DialogoUsuario, Usuario>>(MatDialogRef);
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly usuario = this.datos.usuario;
  protected readonly formulario = this.fb.group({
    nombre: [this.usuario?.nombre ?? '', Validators.required],
    correo: [this.usuario?.correo ?? '', [Validators.required, Validators.email]],
    activo: [this.usuario?.activo ?? true],
    /** En pantalla va en %; la API lo guarda como proporción (15 → 0.15). */
    comisionPorcentaje: this.fb.control<number>(Number(this.usuario?.comisionVenta ?? '0') * 100, [
      Validators.min(0),
      Validators.max(100),
    ]),
  });
  protected readonly elegidos = signal<ReadonlySet<string>>(new Set(this.usuario?.roles ?? []));
  protected readonly sinRoles = signal(false);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected alternar(clave: string, elegido: boolean): void {
    this.elegidos.update((actuales) => {
      const nuevos = new Set(actuales);
      if (elegido) nuevos.add(clave);
      else nuevos.delete(clave);
      return nuevos;
    });
    this.sinRoles.set(this.elegidos().size === 0);
  }

  protected async guardar(): Promise<void> {
    this.formulario.markAllAsTouched();
    this.sinRoles.set(this.elegidos().size === 0);
    if (this.formulario.invalid || this.sinRoles() || this.guardando()) return;
    this.guardando.set(true);
    this.error.set(null);
    const { comisionPorcentaje, ...valor } = this.formulario.getRawValue();
    const cuerpo = {
      ...valor,
      roles: [...this.elegidos()],
      comisionVenta: ((comisionPorcentaje || 0) / 100).toFixed(4),
    };
    try {
      const guardado = this.usuario
        ? await this.api.put<Usuario>(`/usuarios/${this.usuario.id}`, cuerpo)
        : await this.api.post<Usuario>('/usuarios', cuerpo);
      this.referencia.close(guardado);
    } catch (error) {
      marcarErroresDelServidor(this.formulario, error);
      this.error.set(mensajeDeError(error));
    } finally {
      this.guardando.set(false);
    }
  }
}

@Component({
  selector: 'uvm-dialogo-ubicacion',
  imports: IMPORTS,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ ubicacion ? 'Editar ' + ubicacion.nombre : 'Nuevo almacén' }}</h2>
    <form [formGroup]="formulario" (ngSubmit)="guardar()" novalidate>
      <mat-dialog-content class="contenido">
        <mat-form-field>
          <mat-label>Nombre</mat-label>
          <input matInput formControlName="nombre" cdkFocusInitial />
          @if (formulario.controls.nombre.invalid) {
            <mat-error>{{
              formulario.controls.nombre.getError('servidor') ?? 'Escribe el nombre.'
            }}</mat-error>
          }
        </mat-form-field>
        <mat-checkbox formControlName="activa">Activa</mat-checkbox>
        <p class="ayuda">
          Una ubicación con piezas no se puede desactivar: primero hay que moverlas.
        </p>
        @if (error()) {
          <p class="error-texto" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancelar</button>
        <button mat-flat-button type="submit" [disabled]="guardando()">Guardar</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .contenido {
      display: grid;
      gap: 0.5rem;
    }
  `,
})
export class DialogoUbicacion {
  protected readonly ubicacion = inject<Ubicacion | null>(MAT_DIALOG_DATA);
  private readonly referencia = inject<MatDialogRef<DialogoUbicacion, Ubicacion>>(MatDialogRef);
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly formulario = this.fb.group({
    nombre: [this.ubicacion?.nombre ?? '', Validators.required],
    activa: [this.ubicacion?.activa ?? true],
  });
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async guardar(): Promise<void> {
    this.formulario.markAllAsTouched();
    if (this.formulario.invalid || this.guardando()) return;
    this.guardando.set(true);
    try {
      const valor = this.formulario.getRawValue();
      const guardada = this.ubicacion
        ? await this.api.put<Ubicacion>(`/ubicaciones/${this.ubicacion.id}`, valor)
        : await this.api.post<Ubicacion>('/ubicaciones', valor);
      this.referencia.close(guardada);
    } catch (error) {
      marcarErroresDelServidor(this.formulario, error);
      this.error.set(mensajeDeError(error));
    } finally {
      this.guardando.set(false);
    }
  }
}
