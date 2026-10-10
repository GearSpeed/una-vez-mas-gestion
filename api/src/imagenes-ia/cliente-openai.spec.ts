import { describe, expect, it, vi } from 'vitest';
import { ClienteOpenAi, clasificarError, type OpcionesClienteOpenAi } from './cliente-openai.js';

const nuevoCliente = (opciones: Partial<OpcionesClienteOpenAi>) =>
  new ClienteOpenAi({
    llave: 'sk',
    base: 'https://x.test/v1',
    modeloImagen: 'modelo-imagen',
    modeloTexto: 'modelo-texto',
    ...opciones,
  });

const error = (code: string | null, type = 'invalid_request_error', message = 'algo') => ({
  error: { code, type, message },
});

describe('clasificarError', () => {
  it.each([
    [429, error('credit_balance_exhausted', 'insufficient_quota')],
    [429, error(null, 'insufficient_quota')],
    [429, error('insufficient_quota', 'insufficient_quota')],
    [429, error('organization_spend_limit_exceeded')],
    [429, error('project_spend_limit_exceeded')],
    [429, error('organization_usage_limit_exceeded')],
    [400, error('billing_hard_limit_reached')],
  ])('%i %j: se acabaron los créditos, no es un error cualquiera', (estado, cuerpo) => {
    const fallo = clasificarError(estado, cuerpo);
    expect(fallo.tipo).toBe('sin_creditos');
    expect(fallo.mensaje).toMatch(/créditos de OpenAI/);
  });

  it('un 429 de ritmo pide esperar', () => {
    expect(clasificarError(429, error('rate_limit_exceeded', 'requests')).tipo).toBe('limite');
    expect(clasificarError(429, error('slow_down', 'rate_limit_error')).tipo).toBe('limite');
  });

  it('la moderación se explica aparte', () => {
    const fallo = clasificarError(400, error('moderation_blocked', 'image_generation_user_error'));
    expect(fallo.tipo).toBe('moderacion');
  });

  it('una llave mala o sin acceso', () => {
    expect(clasificarError(401, error('invalid_api_key')).tipo).toBe('llave');
    expect(clasificarError(403, error(null)).tipo).toBe('llave');
  });

  it('una petición que OpenAI no aceptó trae su motivo', () => {
    const fallo = clasificarError(400, error('invalid_value', undefined, 'Invalid model'));
    expect(fallo).toMatchObject({ tipo: 'servicio' });
    expect(fallo.mensaje).toContain('Invalid model');
  });

  it('un 500, un 503 o una respuesta sin JSON: el servicio', () => {
    expect(clasificarError(500, null).tipo).toBe('servicio');
    expect(clasificarError(503, error('server_is_overloaded')).tipo).toBe('servicio');
  });
});

describe('ClienteOpenAi', () => {
  const imagenes = [
    { datos: Buffer.from('ref'), nombre: 'referencia.jpg', tipo: 'image/jpeg' as const },
    { datos: Buffer.from('foto'), nombre: 'producto.jpg', tipo: 'image/jpeg' as const },
  ];

  it('manda las dos imágenes en orden con el prompt, y regresa el PNG', async () => {
    const pedir = vi.fn<typeof fetch>(async () =>
      Response.json({ data: [{ b64_json: Buffer.from('png').toString('base64') }] }),
    );
    const cliente = nuevoCliente({
      llave: 'sk-prueba',
      base: 'https://api.example.test/v1',
      pedir,
    });
    const resultado = await cliente.editar({ imagenes, prompt: 'Una mesa', calidad: 'media' });

    expect(resultado).toEqual({ ok: true, png: Buffer.from('png') });
    const [url, opciones] = pedir.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example.test/v1/images/edits');
    expect(opciones?.headers).toEqual({ Authorization: 'Bearer sk-prueba' });
    const cuerpo = opciones?.body as FormData;
    expect(cuerpo.get('model')).toBe('modelo-imagen');
    expect(cuerpo.get('prompt')).toBe('Una mesa');
    expect(cuerpo.get('quality')).toBe('medium');
    const enviadas = cuerpo.getAll('image[]') as File[];
    expect(enviadas.map((f) => f.name)).toEqual(['referencia.jpg', 'producto.jpg']);
    expect(await enviadas[1]?.text()).toBe('foto');
  });

  it('sin créditos regresa el fallo clasificado, sin lanzar', async () => {
    const pedir = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { code: 'credit_balance_exhausted', type: 'insufficient_quota', message: 'x' } },
        { status: 429 },
      ),
    );
    const cliente = nuevoCliente({ pedir });
    const resultado = await cliente.editar({ imagenes, prompt: 'p', calidad: 'baja' });
    expect(resultado).toMatchObject({ ok: false, tipo: 'sin_creditos' });
  });

  it('si OpenAI no contesta a tiempo, se deja de esperar', async () => {
    const pedir = vi.fn<typeof fetch>(
      (_url, opciones) =>
        new Promise((_resuelve, rechaza) => {
          opciones?.signal?.addEventListener('abort', () => rechaza(opciones.signal?.reason));
        }),
    );
    const cliente = nuevoCliente({ pedir, tiempoMaximo: 20 });
    const resultado = await cliente.editar({ imagenes, prompt: 'p', calidad: 'alta' });
    expect(resultado).toMatchObject({ ok: false, tipo: 'servicio' });
    if (!resultado.ok) expect(resultado.mensaje).toMatch(/tardó más de 1 segundo/);
  });

  it('la llave nunca sale en el detalle del error', async () => {
    const pedir = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    const cliente = nuevoCliente({ llave: 'sk-secreta', pedir });
    const resultado = await cliente.editar({ imagenes, prompt: 'p', calidad: 'media' });
    expect(JSON.stringify(resultado)).not.toContain('sk-secreta');
  });
});

/** Lo que contesta `POST /responses`: un razonamiento y luego el mensaje. */
function respuesta(contenido: object[]): Response {
  return Response.json({
    output: [{ type: 'reasoning' }, { type: 'message', content: contenido }],
  });
}

describe('describirReferencia', () => {
  it('manda la imagen con salida estructurada y regresa nombre y prompt', async () => {
    const pedir = vi.fn<typeof fetch>(async () =>
      respuesta([
        {
          type: 'output_text',
          text: JSON.stringify({ nombre: ' Mesa de madera ', prompt: 'Luz cálida de mañana.' }),
        },
      ]),
    );
    const resultado = await nuevoCliente({ pedir }).describirReferencia(Buffer.from('jpg'));
    expect(resultado).toEqual({
      ok: true,
      nombre: 'Mesa de madera',
      prompt: 'Luz cálida de mañana.',
    });

    const [url, opciones] = pedir.mock.calls[0] ?? [];
    expect(url).toBe('https://x.test/v1/responses');
    const cuerpo = JSON.parse(opciones?.body as string);
    expect(cuerpo.model).toBe('modelo-texto');
    expect(cuerpo.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(cuerpo.input[0].content[1]).toEqual({
      type: 'input_image',
      image_url: `data:image/jpeg;base64,${Buffer.from('jpg').toString('base64')}`,
    });
  });

  it('recorta lo que no cabe en el formulario', async () => {
    const pedir = vi.fn<typeof fetch>(async () =>
      respuesta([
        { type: 'output_text', text: JSON.stringify({ nombre: 'x'.repeat(90), prompt: 'Luz.' }) },
      ]),
    );
    const resultado = await nuevoCliente({ pedir }).describirReferencia(Buffer.from('jpg'));
    expect(resultado.ok && resultado.nombre.length).toBe(60);
  });

  it('un rechazo o una respuesta que no es JSON no se cuelan como sugerencia', async () => {
    const rechazo = vi.fn<typeof fetch>(async () =>
      respuesta([{ type: 'refusal', refusal: 'No puedo ayudar con eso.' }]),
    );
    expect(
      await nuevoCliente({ pedir: rechazo }).describirReferencia(Buffer.from('x')),
    ).toMatchObject({
      ok: false,
      tipo: 'moderacion',
    });
    const roto = vi.fn<typeof fetch>(async () =>
      respuesta([{ type: 'output_text', text: 'hola' }]),
    );
    expect(await nuevoCliente({ pedir: roto }).describirReferencia(Buffer.from('x'))).toMatchObject(
      {
        ok: false,
        tipo: 'servicio',
      },
    );
  });

  it('sin créditos se explica igual que al generar', async () => {
    const pedir = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { code: 'credit_balance_exhausted', type: 'insufficient_quota' } },
        { status: 429 },
      ),
    );
    expect(await nuevoCliente({ pedir }).describirReferencia(Buffer.from('x'))).toMatchObject({
      ok: false,
      tipo: 'sin_creditos',
    });
  });
});

/** Un `fetch` que contesta `POST /responses` con ese JSON. */
function contesta(cuerpo: object) {
  return vi.fn<typeof fetch>(async () =>
    respuesta([{ type: 'output_text', text: JSON.stringify(cuerpo) }]),
  );
}

describe('redactarFicha', () => {
  const producto = {
    nombre: 'Galletas de Avena',
    categoria: 'Galletas',
    variedad: 'Avena con pasas',
    presentacion: '6 pzas',
  };
  const imagen = {
    datos: Buffer.from('webp'),
    nombre: 'producto.webp',
    tipo: 'image/webp' as const,
  };
  const ficha = {
    resumen: 'Crujientes por fuera, suaves por dentro.',
    descripcion: 'Galletas de avena horneadas en casa.',
    ingredientes: ['avena', 'pasas', 'Avena', ' ', 'canela'],
    destacadoEtiqueta: 'Clásico',
    destacadoQuip: 'Para el café de la tarde',
    destacadoTexto: 'La de siempre, como en casa.',
  };
  it('manda la foto, los datos y los ejemplos, y limpia los ingredientes repetidos', async () => {
    const pedir = contesta(ficha);
    const resultado = await nuevoCliente({ pedir }).redactarFicha(producto, imagen, [
      { nombre: 'Galletas de Nuez', resumen: 'Con nuez de verdad.', descripcion: 'Doraditas.' },
    ]);
    expect(resultado).toEqual({
      ok: true,
      ficha: { ...ficha, ingredientes: ['avena', 'pasas', 'canela'] },
    });

    const cuerpo = JSON.parse(pedir.mock.calls[0]?.[1]?.body as string);
    expect(cuerpo.model).toBe('modelo-texto');
    expect(cuerpo.text.format).toMatchObject({ name: 'ficha_de_producto', strict: true });
    expect(cuerpo.text.format.schema.required).toEqual([
      'resumen',
      'descripcion',
      'ingredientes',
      'destacadoEtiqueta',
      'destacadoQuip',
      'destacadoTexto',
    ]);
    const [instrucciones, foto] = cuerpo.input[0].content;
    expect(instrucciones.text).toContain('Variedad: Avena con pasas');
    expect(instrucciones.text).toContain('Presentación: 6 pzas');
    expect(instrucciones.text).toContain('Galletas de Nuez');
    expect(instrucciones.text).toContain('sin gluten');
    expect(foto.image_url).toMatch(/^data:image\/webp;base64,/);
  });

  it('lo que no cabe se recorta en una palabra completa, y a lo más 12 ingredientes', async () => {
    const largo = Array.from({ length: 60 }, () => 'palabra').join(' ');
    const pedir = contesta({
      ...ficha,
      resumen: largo,
      ingredientes: Array.from({ length: 20 }, (_, i) => `ingrediente ${i}`),
    });
    const resultado = await nuevoCliente({ pedir }).redactarFicha(producto, imagen, []);
    if (!resultado.ok) throw new Error('Debía salir');
    expect(resultado.ficha.resumen.length).toBeLessThanOrEqual(160);
    expect(resultado.ficha.resumen).toMatch(/palabra…$/);
    expect(resultado.ficha.ingredientes).toHaveLength(12);
  });

  it('sin resumen o descripción no es una ficha', async () => {
    const pedir = contesta({ ...ficha, descripcion: '  ' });
    expect(await nuevoCliente({ pedir }).redactarFicha(producto, imagen, [])).toMatchObject({
      ok: false,
      tipo: 'servicio',
    });
  });
});
