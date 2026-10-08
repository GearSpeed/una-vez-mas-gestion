import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, ANA, como, crearApp, reiniciarBd } from './ayudantes.js';

/** Una cuenta inventada: la CLABE tiene su dígito verificador correcto, nada más. */
const CUENTA = { banco: 'Banco de Prueba', titular: 'Una Vez Más', clabe: '002 180 00000000001 2' };

/** Un «QR» de prueba: PNG cuadrado de 2000 px, más grande de lo que se guarda. */
function qr(): Promise<Buffer> {
  return sharp({ create: { width: 2000, height: 2000, channels: 3, background: '#000' } })
    .png()
    .toBuffer();
}

describe('datos para cobrar por transferencia', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await crearApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await reiniciarBd();
  });

  const subirQr = async (
    posicion: number,
    titulo: string,
    archivo?: Buffer,
    correo: string = ADMIN,
  ) => {
    const peticion = request(app.getHttpServer())
      .put(`/api/transferencia/qr/${posicion}`)
      .set('X-Dev-Correo', correo)
      .set('Sec-Fetch-Site', 'same-origin')
      .field('titulo', titulo);
    return archivo ? peticion.attach('archivo', archivo, 'qr.png') : peticion;
  };

  it('sin datos capturados responde vacío (el front lo lee como null)', async () => {
    const respuesta = await como(app, ANA).get('/transferencia');
    expect(respuesta.status).toBe(200);
    expect(respuesta.text).toBe('');
  });

  it('el administrador los guarda y la vendedora los lee', async () => {
    const guardado = await como(app, ADMIN).put('/transferencia', CUENTA);
    expect(guardado.status).toBe(200);
    const esperado = {
      banco: 'Banco de Prueba',
      titular: 'Una Vez Más',
      clabe: '002180000000000012',
      qrs: [],
    };
    expect(guardado.body).toEqual(esperado);
    expect((await como(app, ANA).get('/transferencia')).body).toEqual(esperado);

    const cambio = await como(app, ADMIN).put('/transferencia', { ...CUENTA, banco: 'Otro' });
    expect(cambio.body.banco).toBe('Otro');
  });

  it('una CLABE mal tecleada no se guarda', async () => {
    const respuesta = await como(app, ADMIN).put('/transferencia', {
      ...CUENTA,
      clabe: '002180000000000013',
    });
    expect(respuesta.status).toBe(422);
    expect(respuesta.body.campos.clabe).toMatch(/dígito verificador/);
  });

  it('la vendedora no puede cambiarlos', async () => {
    expect((await como(app, ANA).put('/transferencia', CUENTA)).status).toBe(403);
    await como(app, ADMIN).put('/transferencia', CUENTA);
    expect((await subirQr(1, 'Mercado Pago', await qr(), ANA)).status).toBe(403);
    expect((await como(app, ANA).delete('/transferencia/qr/1')).status).toBe(403);
  });

  it('el QR se guarda en PNG de 1024 px, lo lee la vendedora y se puede quitar', async () => {
    expect((await subirQr(1, 'Mercado Pago', await qr())).status).toBe(404);
    await como(app, ADMIN).put('/transferencia', CUENTA);

    const subido = await subirQr(1, ' Mercado Pago ', await qr());
    expect(subido.status).toBe(200);
    expect(subido.body.qrs).toEqual([{ posicion: 1, titulo: 'Mercado Pago' }]);

    const leido = await como(app, ANA).get('/transferencia/qr/1').buffer(true);
    expect(leido.status).toBe(200);
    expect(leido.headers['content-type']).toBe('image/png');
    expect(leido.headers['cache-control']).toBe('private, no-store');
    expect(await sharp(leido.body as Buffer).metadata()).toMatchObject({
      format: 'png',
      width: 1024,
      height: 1024,
    });

    const quitado = await como(app, ADMIN).delete('/transferencia/qr/1');
    expect(quitado.body.qrs).toEqual([]);
    expect((await como(app, ANA).get('/transferencia/qr/1')).status).toBe(404);
    expect((await como(app, ADMIN).delete('/transferencia/qr/1')).status).toBe(404);
  });

  it('caben dos QR, cada uno con su título, y se manejan por separado', async () => {
    await como(app, ADMIN).put('/transferencia', CUENTA);
    await subirQr(2, 'Banco de respaldo', await qr());
    await subirQr(1, 'Mercado Pago', await qr());
    expect((await como(app, ANA).get('/transferencia')).body.qrs).toEqual([
      { posicion: 1, titulo: 'Mercado Pago' },
      { posicion: 2, titulo: 'Banco de respaldo' },
    ]);

    // Sin archivo solo cambia el título; la imagen se queda.
    const retitulado = await subirQr(2, 'Otro banco');
    expect(retitulado.status).toBe(200);
    expect(retitulado.body.qrs[1]).toEqual({ posicion: 2, titulo: 'Otro banco' });
    expect((await como(app, ANA).get('/transferencia/qr/2')).status).toBe(200);

    const quitado = await como(app, ADMIN).delete('/transferencia/qr/1');
    expect(quitado.body.qrs).toEqual([{ posicion: 2, titulo: 'Otro banco' }]);
    expect((await como(app, ANA).get('/transferencia/qr/2')).status).toBe(200);
  });

  it('solo hay dos lugares, y cada QR lleva título e imagen', async () => {
    await como(app, ADMIN).put('/transferencia', CUENTA);
    expect((await subirQr(3, 'Tercero', await qr())).status).toBe(404);
    expect((await como(app, ANA).get('/transferencia/qr/abc')).status).toBe(404);

    const sinTitulo = await subirQr(1, '  ', await qr());
    expect(sinTitulo.status).toBe(422);
    expect(sinTitulo.body.campos.titulo).toBeTruthy();

    const sinImagen = await subirQr(1, 'Mercado Pago');
    expect(sinImagen.status).toBe(422);
    expect(sinImagen.body.campos.archivo).toBeTruthy();
  });

  it('rechaza un archivo que no es imagen', async () => {
    await como(app, ADMIN).put('/transferencia', CUENTA);
    const respuesta = await subirQr(1, 'Mercado Pago', Buffer.from('no soy una imagen'));
    expect(respuesta.status).toBe(422);
    expect(respuesta.body.campos.archivo).toBeTruthy();
  });
});
