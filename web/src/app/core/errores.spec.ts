import { HttpErrorResponse } from '@angular/common/http';
import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { marcarErroresDelServidor, mensajeDeError } from './errores';

describe('mensajeDeError', () => {
  it('usa el mensaje en español de la API', () => {
    const error = new HttpErrorResponse({
      status: 409,
      error: { mensaje: 'Solo hay 2 de Galletas de Avena en Ana.' },
    });
    expect(mensajeDeError(error)).toBe('Solo hay 2 de Galletas de Avena en Ana.');
  });

  it('sin respuesta explica que no hay conexión', () => {
    expect(mensajeDeError(new HttpErrorResponse({ status: 0 }))).toMatch(/No hay conexión/);
  });

  it('con un error cualquiera no muestra detalles técnicos', () => {
    expect(mensajeDeError(new Error('TypeError: x is undefined'))).toBe(
      'Algo salió mal. Intenta de nuevo.',
    );
  });
});

describe('marcarErroresDelServidor', () => {
  it('marca el campo exacto que rechazó la API, también dentro de listas', () => {
    const formulario = new FormGroup({
      fecha: new FormControl('2026-09-21'),
      lineas: new FormArray([
        new FormGroup({ productoId: new FormControl(1) }),
        new FormGroup({ productoId: new FormControl(1) }),
      ]),
    });
    const error = new HttpErrorResponse({
      status: 422,
      error: {
        mensaje: 'Revisa los datos marcados.',
        campos: { 'lineas.1.productoId': 'Este producto ya está en la lista' },
      },
    });

    expect(marcarErroresDelServidor(formulario, error)).toBe(true);
    expect(formulario.get('lineas.1.productoId')?.getError('servidor')).toBe(
      'Este producto ya está en la lista',
    );
    expect(formulario.get('lineas.0.productoId')?.valid).toBe(true);
  });

  it('si no hay campos, no marca nada', () => {
    const formulario = new FormGroup({ fecha: new FormControl('') });
    expect(
      marcarErroresDelServidor(
        formulario,
        new HttpErrorResponse({ status: 409, error: { mensaje: 'x' } }),
      ),
    ).toBe(false);
  });
});
