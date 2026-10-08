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

  const subirQr = async (archivo: Buffer, correo = ADMIN) =>
    request(app.getHttpServer())
      .post('/api/transferencia/qr')
      .set('X-Dev-Correo', correo)
      .set('Sec-Fetch-Site', 'same-origin')
      .attach('archivo', archivo, 'qr.png');

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
      tieneQr: false,
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
    expect((await subirQr(await qr(), ANA)).status).toBe(403);
    expect((await como(app, ANA).delete('/transferencia/qr')).status).toBe(403);
  });

  it('el QR se guarda en PNG de 1024 px, lo lee la vendedora y se puede quitar', async () => {
    expect((await subirQr(await qr())).status).toBe(404);
    await como(app, ADMIN).put('/transferencia', CUENTA);

    const subido = await subirQr(await qr());
    expect(subido.status).toBe(201);
    expect(subido.body.tieneQr).toBe(true);

    const leido = await como(app, ANA).get('/transferencia/qr').buffer(true);
    expect(leido.status).toBe(200);
    expect(leido.headers['content-type']).toBe('image/png');
    expect(leido.headers['cache-control']).toBe('private, no-store');
    expect(await sharp(leido.body as Buffer).metadata()).toMatchObject({
      format: 'png',
      width: 1024,
      height: 1024,
    });

    const quitado = await como(app, ADMIN).delete('/transferencia/qr');
    expect(quitado.body.tieneQr).toBe(false);
    expect((await como(app, ANA).get('/transferencia/qr')).status).toBe(404);
  });

  it('rechaza un archivo que no es imagen', async () => {
    await como(app, ADMIN).put('/transferencia', CUENTA);
    const respuesta = await subirQr(Buffer.from('no soy una imagen'));
    expect(respuesta.status).toBe(422);
    expect(respuesta.body.campos.archivo).toBeTruthy();
  });
});
