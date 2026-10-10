import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, ANA, CONSULTA, como, conexion, crearApp, IDS, reiniciarBd } from './ayudantes.js';

/** Imágenes inventadas: un cuadro de color. */
function imagen(color: string, formato: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  const lienzo = sharp({ create: { width: 800, height: 600, channels: 3, background: color } });
  return (formato === 'png' ? lienzo.png() : lienzo.jpeg()).toBuffer();
}

function responderJson(respuesta: ServerResponse, codigo: number, cuerpo: unknown): void {
  respuesta.writeHead(codigo, { 'content-type': 'application/json' });
  respuesta.end(JSON.stringify(cuerpo));
}

type Modo = 'bien' | 'sin_creditos' | 'moderacion';

/**
 * Un OpenAI de mentiras en la misma máquina: contesta `/v1/images/edits` según `modo`
 * y guarda lo que le llegó para revisarlo.
 */
function openAiFalso() {
  const estado = {
    modo: 'bien' as Modo,
    peticiones: [] as { autorizacion: string; cuerpo: string }[],
  };
  let png: Buffer = Buffer.alloc(0);
  const servidor: Server = createServer((solicitud, respuesta) => {
    const partes: Buffer[] = [];
    solicitud.on('data', (parte: Buffer) => partes.push(parte));
    solicitud.on('end', () => {
      estado.peticiones.push({
        autorizacion: solicitud.headers.authorization ?? '',
        cuerpo: Buffer.concat(partes).toString('latin1'),
      });
      if (solicitud.url !== '/v1/images/edits') return responderJson(respuesta, 404, {});
      if (estado.modo === 'sin_creditos') {
        return responderJson(respuesta, 429, {
          error: {
            code: 'credit_balance_exhausted',
            type: 'insufficient_quota',
            message: 'You exceeded your current quota.',
          },
        });
      }
      if (estado.modo === 'moderacion') {
        return responderJson(respuesta, 400, {
          error: {
            code: 'moderation_blocked',
            type: 'image_generation_user_error',
            message: 'Your request was rejected by the safety system.',
          },
        });
      }
      return responderJson(respuesta, 200, { data: [{ b64_json: png.toString('base64') }] });
    });
  });
  return {
    estado,
    async iniciar(): Promise<string> {
      png = await imagen('#5b0021');
      await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
      return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/v1`;
    },
    cerrar: () => new Promise<void>((listo) => servidor.close(() => listo())),
  };
}

const REFERENCIA = {
  nombre: 'Mesa de madera',
  prompt: 'Sobre una mesa de madera clara, luz cálida de mañana, fondo desenfocado.',
};

describe('imágenes con IA', () => {
  const openAi = openAiFalso();
  let app: INestApplication;

  beforeAll(async () => {
    process.env['OPENAI_URL_BASE'] = await openAi.iniciar();
    process.env['OPENAI_API_KEY'] = 'sk-de-prueba';
    app = await crearApp();
  });
  afterAll(async () => {
    await app.close();
    await openAi.cerrar();
  });
  beforeEach(async () => {
    await reiniciarBd();
    openAi.estado.modo = 'bien';
    openAi.estado.peticiones = [];
  });

  const http = (correo = ADMIN) => ({
    post: (ruta: string) =>
      request(app.getHttpServer())
        .post(`/api/imagenes-ia${ruta}`)
        .set('X-Dev-Correo', correo)
        .set('Sec-Fetch-Site', 'same-origin'),
    put: (ruta: string) =>
      request(app.getHttpServer())
        .put(`/api/imagenes-ia${ruta}`)
        .set('X-Dev-Correo', correo)
        .set('Sec-Fetch-Site', 'same-origin'),
  });

  async function crearReferencia(): Promise<number> {
    const respuesta = await http()
      .post('/referencias')
      .field('nombre', REFERENCIA.nombre)
      .field('prompt', REFERENCIA.prompt)
      .attach('archivo', await imagen('#c8913c'), 'mesa.png');
    expect(respuesta.status).toBe(201);
    return respuesta.body.id as number;
  }

  async function generar(
    referenciaId: number,
    {
      promptExtra = '',
      foto = true,
      fotoDe,
    }: { promptExtra?: string; foto?: boolean; fotoDe?: number } = {},
  ) {
    let peticion = http()
      .post('/generaciones')
      .field('referenciaId', String(referenciaId))
      .field('calidad', 'baja')
      .field('promptExtra', promptExtra);
    if (fotoDe) peticion = peticion.field('fotoDe', String(fotoDe));
    if (foto) peticion = peticion.attach('foto', await imagen('#ffffff', 'jpeg'), 'galletas.jpg');
    return peticion;
  }

  /** La generación corre en segundo plano: se pregunta hasta que deja de «generando». */
  async function terminada(id: number) {
    for (let intento = 0; intento < 100; intento++) {
      const { body } = await como(app, ADMIN).get(`/imagenes-ia/generaciones/${id}`);
      if (body.estado !== 'generando') return body;
      await new Promise((listo) => setTimeout(listo, 50));
    }
    throw new Error(`La generación ${id} no terminó`);
  }

  it('las referencias se suben, se editan y se quitan; solo con el permiso', async () => {
    const id = await crearReferencia();
    const lista = await como(app, ADMIN).get('/imagenes-ia/referencias');
    expect(lista.body).toEqual([expect.objectContaining({ id, ...REFERENCIA })]);

    // La imagen se sirve con sesión y ya preparada (JPEG, sin metadatos).
    const archivo = await como(app, ADMIN).get(`/imagenes-ia/referencias/${id}/imagen`);
    expect(archivo.status).toBe(200);
    expect(archivo.headers['content-type']).toBe('image/jpeg');

    const editada = await http()
      .put(`/referencias/${id}`)
      .field('nombre', 'Mesa clara')
      .field('prompt', REFERENCIA.prompt);
    expect(editada.status).toBe(200);
    expect(editada.body.nombre).toBe('Mesa clara');

    expect((await como(app, ADMIN).delete(`/imagenes-ia/referencias/${id}`)).status).toBe(204);
    expect((await como(app, ADMIN).get('/imagenes-ia/referencias')).body).toEqual([]);

    expect((await como(app, ANA).get('/imagenes-ia/referencias')).status).toBe(403);
    expect((await como(app, CONSULTA).get('/imagenes-ia/estado')).status).toBe(403);
  });

  it('genera con la referencia y la foto, y la asigna a un producto', async () => {
    const referenciaId = await crearReferencia();
    const pedida = await generar(referenciaId, { promptExtra: 'Con hojas de menta' });
    expect(pedida.status).toBe(202);
    expect(pedida.body).toMatchObject({ estado: 'generando', referencia: REFERENCIA.nombre });

    const lista = await terminada(pedida.body.id);
    expect(lista).toMatchObject({ estado: 'lista', error: null, calidad: 'baja' });

    // A OpenAI le llegó la llave, las dos imágenes y el prompt con todo.
    const [peticion] = openAi.estado.peticiones;
    expect(peticion?.autorizacion).toBe('Bearer sk-de-prueba');
    expect(peticion?.cuerpo.match(/name="image\[\]"/g)).toHaveLength(2);
    expect(peticion?.cuerpo).toContain('quality');
    expect(peticion?.cuerpo).toContain('Sobre una mesa de madera clara');
    expect(peticion?.cuerpo).toContain('Con hojas de menta');

    const resultado = await como(app, ADMIN).get(`/imagenes-ia/generaciones/${lista.id}/imagen`);
    expect(resultado.headers['content-type']).toBe('image/png');

    const asignada = await como(app, ADMIN).post(`/imagenes-ia/generaciones/${lista.id}/asignar`, {
      productoId: IDS.tejocote,
      alt: 'Galletas de tejocote sobre una mesa de madera',
    });
    expect(asignada.status).toBe(200);
    expect(asignada.body.imagen).toMatchObject({
      alt: 'Galletas de tejocote sobre una mesa de madera',
    });

    const despues = await como(app, ADMIN).get(`/imagenes-ia/generaciones/${lista.id}`);
    expect(despues.body).toMatchObject({
      estado: 'asignada',
      producto: { id: IDS.tejocote },
    });
    // Ya está en el bucket: aquí se soltó.
    expect(
      (await como(app, ADMIN).get(`/imagenes-ia/generaciones/${lista.id}/imagen`)).status,
    ).toBe(404);
    // Y no se asigna dos veces.
    const otraVez = await como(app, ADMIN).post(`/imagenes-ia/generaciones/${lista.id}/asignar`, {
      productoId: IDS.coco,
      alt: 'Galletas sobre una mesa de madera',
    });
    expect(otraVez.status).toBe(409);
  });

  it('sin créditos lo dice con todas sus letras, y el aviso se va al volver a funcionar', async () => {
    const referenciaId = await crearReferencia();
    openAi.estado.modo = 'sin_creditos';
    const pedida = await generar(referenciaId);
    const fallida = await terminada(pedida.body.id);
    expect(fallida).toMatchObject({ estado: 'error', error: { tipo: 'sin_creditos' } });
    expect(fallida.error.mensaje).toMatch(/créditos de OpenAI/);

    const estado = await como(app, ADMIN).get('/imagenes-ia/estado');
    expect(estado.body.configurado).toBe(true);
    expect(estado.body.sinCreditosDesde).toEqual(expect.any(String));

    // Ya recargaron: vuelve a salir y el aviso desaparece. Sin volver a subir la foto.
    openAi.estado.modo = 'bien';
    const otra = await generar(referenciaId, { foto: false, fotoDe: pedida.body.id });
    expect(otra.status).toBe(202);
    expect((await terminada(otra.body.id)).estado).toBe('lista');
    expect((await como(app, ADMIN).get('/imagenes-ia/estado')).body.sinCreditosDesde).toBeNull();
  });

  it('si la rechaza la moderación, lo explica', async () => {
    const referenciaId = await crearReferencia();
    openAi.estado.modo = 'moderacion';
    const fallida = await terminada((await generar(referenciaId)).body.id);
    expect(fallida.error).toMatchObject({ tipo: 'moderacion' });
  });

  it('se descarta y deja de aparecer; sin foto no se genera', async () => {
    const referenciaId = await crearReferencia();
    const lista = await terminada((await generar(referenciaId)).body.id);
    const descartada = await como(app, ADMIN).post(
      `/imagenes-ia/generaciones/${lista.id}/descartar`,
    );
    expect(descartada.body.estado).toBe('descartada');
    expect((await como(app, ADMIN).get('/imagenes-ia/generaciones')).body).toEqual([]);
    expect(
      (await como(app, ADMIN).post(`/imagenes-ia/generaciones/${lista.id}/descartar`)).status,
    ).toBe(409);

    const sinFoto = await generar(referenciaId, { foto: false });
    expect(sinFoto.status).toBe(422);
  });

  it('asignar cambia el sitio: hace falta también poder gestionar productos', async () => {
    const owner = conexion('owner');
    await owner.execute(sql`
      insert into gestion.rol_permisos (rol_id, permiso)
      select id, 'imagenes.generar' from gestion.roles where clave = 'consulta'`);
    await owner.$client.end();

    const referenciaId = await crearReferencia();
    const lista = await terminada((await generar(referenciaId)).body.id);
    const respuesta = await como(app, CONSULTA).post(
      `/imagenes-ia/generaciones/${lista.id}/asignar`,
      { productoId: IDS.tejocote, alt: 'Galletas sobre una mesa de madera' },
    );
    expect(respuesta.status).toBe(403);
    expect((await como(app, ADMIN).get(`/imagenes-ia/generaciones/${lista.id}`)).body.estado).toBe(
      'lista',
    );
  });
});

describe('imágenes con IA sin llave de OpenAI', () => {
  let app: INestApplication;
  beforeAll(async () => {
    delete process.env['OPENAI_API_KEY'];
    app = await crearApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await reiniciarBd();
  });

  it('dice que falta configurarla en vez de fallar', async () => {
    expect((await como(app, ADMIN).get('/imagenes-ia/estado')).body).toEqual({
      configurado: false,
      sinCreditosDesde: null,
    });
    const respuesta = await request(app.getHttpServer())
      .post('/api/imagenes-ia/generaciones')
      .set('X-Dev-Correo', ADMIN)
      .set('Sec-Fetch-Site', 'same-origin')
      .field('referenciaId', '1');
    expect(respuesta.status).toBe(503);
    expect(respuesta.body.mensaje).toMatch(/OPENAI_API_KEY/);
  });
});
