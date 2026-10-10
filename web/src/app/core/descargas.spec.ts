import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DescargasService } from './descargas';
import { mensajeDeError } from './errores';

describe('DescargasService', () => {
  let descargas: DescargasService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    descargas = TestBed.inject(DescargasService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('guarda el archivo con el nombre que se le pide', async () => {
    const crear = vi.fn(() => 'blob:prueba');
    const revocar = vi.fn();
    Object.assign(URL, { createObjectURL: crear, revokeObjectURL: revocar });
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const descarga = descargas.descargar('/api/reportes/analisis/excel', 'analisis.xlsx');
    http.expectOne('/api/reportes/analisis/excel').flush(new Blob(['xlsx']));
    await descarga;

    expect(crear).toHaveBeenCalledOnce();
    expect(clic).toHaveBeenCalledOnce();
    clic.mockRestore();
  });

  it('si la API rechaza la descarga, muestra su mensaje y no un código', async () => {
    const descarga = descargas.descargar('/api/reportes/analisis/excel', 'analisis.xlsx');
    http.expectOne('/api/reportes/analisis/excel').flush(
      new Blob([JSON.stringify({ mensaje: 'El periodo no puede pasar de 366 días.' })], {
        type: 'application/json',
      }),
      { status: 422, statusText: 'Unprocessable Entity' },
    );

    const error = await descarga.catch((e: unknown) => e);
    expect(mensajeDeError(error)).toBe('El periodo no puede pasar de 366 días.');
  });
});
