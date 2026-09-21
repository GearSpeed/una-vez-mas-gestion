import { DatePipe } from '@angular/common';
import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatTabsModule } from '@angular/material/tabs';
import type { Rol, Ubicacion, Usuario } from '@uvm/compartido';
import { AvisosService } from '../../core/avisos';
import { Desplazable } from '../../ui/desplazable';
import { Encabezado } from '../../ui/encabezado';
import { EstadoCarga } from '../../ui/estado-carga';
import { EtiquetaPipe } from '../../ui/etiqueta.pipe';
import { type DatosDialogoUsuario, DialogoUbicacion, DialogoUsuario } from './dialogos';

@Component({
  selector: 'uvm-usuarios',
  imports: [
    Desplazable,
    Encabezado,
    EstadoCarga,
    EtiquetaPipe,
    DatePipe,
    MatButtonModule,
    MatTabsModule,
  ],
  templateUrl: './usuarios.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Usuarios {
  private readonly dialogo = inject(MatDialog);
  private readonly avisos = inject(AvisosService);

  protected readonly usuarios = httpResource<Usuario[]>(() => '/api/usuarios');
  protected readonly roles = httpResource<Rol[]>(() => '/api/roles');
  protected readonly ubicaciones = httpResource<Ubicacion[]>(() => '/api/ubicaciones');

  private readonly nombreDeRol = computed(
    () => new Map((this.roles.value() ?? []).map((r) => [r.clave, r.nombre])),
  );

  protected nombresDeRoles(claves: readonly string[]): string {
    return claves.map((clave) => this.nombreDeRol().get(clave) ?? clave).join(', ');
  }

  protected abrirUsuario(usuario: Usuario | null): void {
    const datos: DatosDialogoUsuario = { usuario, roles: this.roles.value() ?? [] };
    this.dialogo
      .open<DialogoUsuario, DatosDialogoUsuario, Usuario>(DialogoUsuario, {
        data: datos,
        width: '40rem',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((guardado) => {
        if (!guardado) return;
        this.avisos.exito(`${guardado.nombre} guardado.`);
        this.usuarios.reload();
        this.ubicaciones.reload();
      });
  }

  protected abrirUbicacion(ubicacion: Ubicacion | null): void {
    this.dialogo
      .open<DialogoUbicacion, Ubicacion | null, Ubicacion>(DialogoUbicacion, {
        data: ubicacion,
        width: '28rem',
        maxWidth: '95vw',
      })
      .afterClosed()
      .subscribe((guardada) => {
        if (!guardada) return;
        this.avisos.exito(`${guardada.nombre} guardada.`);
        this.ubicaciones.reload();
      });
  }
}
