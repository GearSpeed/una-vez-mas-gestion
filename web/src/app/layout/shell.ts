import { BreakpointObserver } from '@angular/cdk/layout';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { menuPara } from '../core/menu';
import { SesionService } from '../core/sesion';

/** Con menos ancho que esto, el menú va encima del contenido y sale cerrado. */
const ANCHO_ESCRITORIO = '(min-width: 80rem)';
/** Si en escritorio lo dejaste cerrado, así se queda la próxima vez. */
const LLAVE_MENU = 'uvm:menu-abierto';

function menuGuardado(): boolean {
  try {
    return localStorage.getItem(LLAVE_MENU) !== 'no';
  } catch {
    return true;
  }
}

function guardarMenu(abierto: boolean): void {
  try {
    localStorage.setItem(LLAVE_MENU, abierto ? 'si' : 'no');
  } catch {
    // Sin almacenamiento el menú simplemente vuelve a salir abierto.
  }
}

/** Correos de la semilla de prueba (`npm run semilla -- --demo`), para cambiar de rol en desarrollo. */
const USUARIOS_PRUEBA = [
  { correo: null, nombre: 'Administrador (DEV_CORREO)' },
  { correo: 'almacen@demo.local', nombre: 'Almacén' },
  { correo: 'ana@demo.local', nombre: 'Ana (vendedora)' },
  { correo: 'beto@demo.local', nombre: 'Beto (vendedor)' },
  { correo: 'consulta@demo.local', nombre: 'Consulta' },
] as const;

@Component({
  selector: 'uvm-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatSidenavModule,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {
  protected readonly sesionService = inject(SesionService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly principal = viewChild.required<ElementRef<HTMLElement>>('principal');

  protected readonly sesion = computed(() => this.sesionService.sesion());
  protected readonly menu = computed(() => {
    const sesion = this.sesion();
    return sesion ? menuPara(sesion, (...p) => this.sesionService.puede(...p)) : [];
  });
  protected readonly usuariosPrueba = USUARIOS_PRUEBA;

  protected readonly esEscritorio = toSignal(
    inject(BreakpointObserver)
      .observe(ANCHO_ESCRITORIO)
      .pipe(map((estado) => estado.matches)),
    { initialValue: false },
  );
  /** En escritorio el menú es una columna fija; en lo demás, una capa encima. */
  private readonly abiertoEnEscritorio = signal(menuGuardado());
  private readonly abiertoEncima = signal(false);
  protected readonly menuAbierto = computed(() =>
    this.esEscritorio() ? this.abiertoEnEscritorio() : this.abiertoEncima(),
  );

  constructor() {
    // Al navegar: se cierra el menú en el celular y el foco va al título de la
    // nueva pantalla, para que el lector de pantalla anuncie dónde está.
    let primera = true;
    this.router.events
      .pipe(
        filter((evento) => evento instanceof NavigationEnd),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(() => {
        // Al cambiar de pantalla se quita de en medio; en escritorio no estorba.
        this.abiertoEncima.set(false);
        if (primera) {
          primera = false;
          return;
        }
        afterNextRender(
          () => {
            const titulo = this.principal().nativeElement.querySelector<HTMLElement>('h1');
            (titulo ?? this.principal().nativeElement).focus();
          },
          { injector: this.injector },
        );
      });
  }

  protected alternarMenu(): void {
    if (this.esEscritorio()) {
      const abierto = !this.abiertoEnEscritorio();
      this.abiertoEnEscritorio.set(abierto);
      guardarMenu(abierto);
    } else {
      this.abiertoEncima.update((abierto) => !abierto);
    }
  }

  /** Cuando se cierra solo (al tocar fuera o con Escape). */
  protected alCerrar(): void {
    if (this.esEscritorio()) {
      this.abiertoEnEscritorio.set(false);
      guardarMenu(false);
    } else {
      this.abiertoEncima.set(false);
    }
  }

  protected cambiarUsuario(correo: string | null): void {
    this.sesionService.cambiarUsuarioDesarrollo(correo);
  }
}
