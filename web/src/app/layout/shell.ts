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
      .observe('(min-width: 64rem)')
      .pipe(map((estado) => estado.matches)),
    { initialValue: false },
  );
  protected readonly menuAbierto = signal(false);

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
        this.menuAbierto.set(false);
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

  protected cambiarUsuario(correo: string | null): void {
    this.sesionService.cambiarUsuarioDesarrollo(correo);
  }
}
