import type { Permiso, UbicacionResumen } from '@uvm/compartido';

/** Quién hace la petición: lo arma el guard de acceso en cada una. */
export class UsuarioSesion {
  constructor(
    readonly id: number,
    readonly correo: string,
    readonly nombre: string,
    readonly roles: readonly { readonly clave: string; readonly nombre: string }[],
    private readonly permisos: ReadonlySet<Permiso>,
    /** La ubicación propia, si vende. */
    readonly ubicacion: UbicacionResumen | null,
  ) {}

  puede(permiso: Permiso): boolean {
    return this.permisos.has(permiso);
  }

  get listaPermisos(): Permiso[] {
    return [...this.permisos].toSorted();
  }
}
