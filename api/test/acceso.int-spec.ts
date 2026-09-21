import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN,
  ALMACEN,
  ANA,
  clave,
  como,
  compraV001,
  CONSULTA,
  crearApp,
  IDS,
  reiniciarBd,
} from './ayudantes.js';

describe('acceso y permisos', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await crearApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(reiniciarBd);

  it('un correo que no está dado de alta no entra', async () => {
    const respuesta = await como(app, 'extrano@correo.com').get('/yo');
    expect(respuesta.status).toBe(403);
    expect(respuesta.body.mensaje).toMatch(/no tiene acceso/);
  });

  it('/yo devuelve permisos y la ubicación propia', async () => {
    const respuesta = await como(app, ANA).get('/yo');
    expect(respuesta.body).toMatchObject({
      correo: ANA,
      permisos: ['catalogo.ver', 'ventas.registrar'],
      ubicacion: { id: IDS.ana, nombre: 'Ana', tipo: 'vendedor' },
      modoDesarrollo: true,
    });
  });

  it('la salud responde sin identidad', async () => {
    const respuesta = await request(app.getHttpServer()).get('/api/salud');
    expect(respuesta.body).toEqual({ ok: true });
  });

  it.each([
    [ANA, 'get', '/compras'],
    [ANA, 'get', '/usuarios'],
    [ANA, 'get', '/reportes/tablero'],
    [ALMACEN, 'get', '/reportes/utilidad'],
    [ALMACEN, 'get', '/usuarios'],
    [CONSULTA, 'post', '/compras'],
    [CONSULTA, 'post', '/ventas'],
    [CONSULTA, 'post', '/productos'],
  ] as const)('%s no puede %s %s', async (correo, metodo, ruta) => {
    const usuario = como(app, correo);
    const respuesta = metodo === 'get' ? await usuario.get(ruta) : await usuario.post(ruta, {});
    expect(respuesta.status).toBe(403);
  });

  it('consulta ve reportes y costos, pero no escribe', async () => {
    await como(app, ALMACEN).post('/compras', compraV001());
    const tablero = await como(app, CONSULTA).get('/reportes/tablero');
    expect(tablero.status).toBe(200);
    expect(tablero.body.costos.valorInventario).toBe('1334.75');
  });

  it('rechaza escrituras que vienen de otro sitio', async () => {
    const respuesta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('X-Dev-Correo', ADMIN)
      .set('Sec-Fetch-Site', 'cross-site')
      .send({});
    expect(respuesta.status).toBe(403);
    expect(respuesta.body.mensaje).toMatch(/otro sitio/);
  });

  describe('usuarios', () => {
    it('al dar el rol de vendedor se crea su ubicación', async () => {
      const creado = await como(app, ADMIN).post('/usuarios', {
        correo: 'Carla@Correo.com',
        nombre: 'Carla',
        roles: ['vendedor'],
      });
      expect(creado.status).toBe(201);
      expect(creado.body).toMatchObject({
        correo: 'carla@correo.com',
        ubicacion: { nombre: 'Carla', tipo: 'vendedor' },
      });
      expect((await como(app, 'carla@correo.com').get('/yo')).body.ubicacion.nombre).toBe('Carla');
    });

    it('no deja un correo repetido', async () => {
      const respuesta = await como(app, ADMIN).post('/usuarios', {
        correo: ANA,
        nombre: 'Otra Ana',
        roles: ['vendedor'],
      });
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.mensaje).toBe('Ya hay un usuario con ese correo.');
    });

    it('siempre queda al menos un administrador', async () => {
      const yo = await como(app, ADMIN).get('/yo');
      const respuesta = await como(app, ADMIN).put(`/usuarios/${yo.body.id}`, {
        correo: ADMIN,
        nombre: 'Admin',
        roles: ['consulta'],
      });
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.mensaje).toMatch(/al menos un administrador/);
    });

    it('no se desactiva a un vendedor que trae mercancía', async () => {
      await como(app, ALMACEN).post('/compras', compraV001());
      await como(app, ALMACEN).post('/inventario/traspasos', {
        claveIdempotencia: clave(),
        origenId: IDS.almacen,
        destinoId: IDS.ana,
        lineas: [{ productoId: IDS.avena, cantidad: 2 }],
      });
      const usuarios = await como(app, ADMIN).get('/usuarios');
      const ana = usuarios.body.find((u: { correo: string }) => u.correo === ANA);
      const respuesta = await como(app, ADMIN).put(`/usuarios/${ana.id}`, {
        correo: ANA,
        nombre: 'Ana',
        roles: ['vendedor'],
        activo: false,
      });
      expect(respuesta.status).toBe(409);
      expect(respuesta.body.mensaje).toMatch(/todavía trae 2 piezas/);
    });

    it('un usuario desactivado ya no entra', async () => {
      const usuarios = await como(app, ADMIN).get('/usuarios');
      const consulta = usuarios.body.find((u: { correo: string }) => u.correo === CONSULTA);
      await como(app, ADMIN).put(`/usuarios/${consulta.id}`, {
        correo: CONSULTA,
        nombre: 'Consulta',
        roles: ['consulta'],
        activo: false,
      });
      expect((await como(app, CONSULTA).get('/yo')).status).toBe(403);
    });
  });
});
