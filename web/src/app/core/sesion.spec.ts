import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Sesion } from '@uvm/compartido';
import { SesionService } from './sesion';

const ANA: Sesion = {
  id: 3,
  correo: 'ana@demo.local',
  nombre: 'Ana',
  roles: [{ clave: 'vendedor', nombre: 'Vendedor' }],
  permisos: ['catalogo.ver', 'ventas.registrar'],
  ubicacion: { id: 2, nombre: 'Ana', tipo: 'vendedor' },
  modoDesarrollo: false,
};

describe('SesionService', () => {
  let servicio: SesionService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    servicio = TestBed.inject(SesionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('carga la sesión y responde por los permisos', async () => {
    const carga = servicio.cargar();
    http.expectOne('/api/yo').flush(ANA);
    await carga;

    expect(servicio.sesion()?.nombre).toBe('Ana');
    expect(servicio.puede('ventas.registrar')).toBe(true);
    expect(servicio.puede('compras.ver', 'ventas.registrar')).toBe(true);
    expect(servicio.puede('costos.ver')).toBe(false);
  });

  it('un correo sin alta queda como problema, sin sesión', async () => {
    const carga = servicio.cargar();
    http
      .expectOne('/api/yo')
      .flush({ mensaje: 'ana@x.com no tiene acceso.' }, { status: 403, statusText: 'Forbidden' });
    await carga;

    expect(servicio.sesion()).toBeNull();
    expect(servicio.problema()).toEqual({ mensaje: 'ana@x.com no tiene acceso.', estado: 403 });
    expect(servicio.puede('catalogo.ver')).toBe(false);
  });
});
