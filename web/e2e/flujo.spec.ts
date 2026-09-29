import { expect, type APIRequestContext, test } from '@playwright/test';
import { restar } from '@uvm/compartido';
import sharp from 'sharp';
import { entrarComo, esperarCarga, sinViolaciones, USUARIOS } from './ayudantes';

/**
 * El recorrido de todos los días, por la interfaz: el admin pone precio, el
 * almacén registra una compra y carga a Ana, y Ana vende desde su celular.
 * Las cuentas se comparan contra lo que había antes, porque la misma BD se usa
 * en escritorio y en celular.
 */

async function piezasDeAna(request: APIRequestContext, producto: string): Promise<number> {
  const respuesta = await request.get('/api/inventario/existencias', {
    headers: { 'X-Dev-Correo': USUARIOS.ana },
  });
  const cuerpo = (await respuesta.json()) as { filas: { producto: string; cantidad: number }[] };
  return cuerpo.filas.find((f) => f.producto === producto)?.cantidad ?? 0;
}

test('precio, compra, carga y venta de punta a punta', async ({ page, request }) => {
  const producto = 'Galletas de Coco';
  const antes = await piezasDeAna(request, producto);

  // 1. El admin le pone precio.
  await entrarComo(page, 'admin');
  await page.goto('/productos');
  await esperarCarga(page);
  await page.getByRole('button', { name: `Editar ${producto}` }).click();
  await page.getByLabel('Precio de venta').fill('28');
  // Se espera la respuesta del guardado, y no solo el aviso: si la API contesta un
  // error o se tarda, el fallo dice cuál de las dos cosas pasó, en vez de dejar
  // «no apareció el aviso», que puede ser cualquiera de las dos.
  const guardado = page.waitForResponse(
    (respuesta) =>
      respuesta.request().method() === 'PUT' && respuesta.url().includes('/api/productos/'),
  );
  await page.getByRole('button', { name: 'Guardar' }).click();
  expect((await guardado).status()).toBe(200);
  await expect(page.getByText(`${producto} guardado.`)).toBeVisible();

  // 2. El almacén registra la compra con su viaje.
  await entrarComo(page, 'almacen');
  await page.goto('/compras/nueva');
  await esperarCarga(page);
  await page.getByRole('combobox', { name: 'Proveedor' }).click();
  await page.getByRole('option', { name: 'Proveedor demo' }).click();
  await page.getByRole('combobox', { name: 'Vehículo' }).click();
  await page.getByRole('option', { name: /Moto demo/ }).click();
  await page.getByLabel('Gasolina ese día').fill('23');
  await page.getByRole('combobox', { name: 'Producto' }).click();
  await page.getByRole('option', { name: producto }).click();
  await page.getByLabel('Piezas').fill('10');
  await page.getByLabel('Precio del proveedor').fill('15.50');
  // 40 km ÷ 32 km/l × $23 = $28.75 entre 10 piezas.
  await expect(page.getByText('$2.875').first()).toBeVisible();
  await page.getByRole('button', { name: 'Registrar compra' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Compra C-\d{6}/ })).toBeVisible();
  await expect(page.getByText('$183.75').first()).toBeVisible();

  // 3. Carga 5 piezas a Ana.
  await page.goto('/inventario/traspasos');
  await esperarCarga(page);
  await page.getByRole('combobox', { name: 'Sale de' }).click();
  await page.getByRole('option', { name: 'Almacén' }).click();
  await page.getByRole('combobox', { name: 'Entra a' }).click();
  await page.getByRole('option', { name: 'Ana' }).click();
  await page.getByRole('combobox', { name: 'Producto' }).click();
  await page.getByRole('option', { name: new RegExp(producto) }).click();
  await page.getByLabel('Piezas').fill('5');
  await page.getByRole('button', { name: 'Registrar traspaso' }).click();
  await expect(page.getByText(/5 piezas de Almacén a Ana/)).toBeVisible();

  // 4. Ana vende 2.
  await entrarComo(page, 'ana');
  await page.goto('/ventas/nueva');
  await esperarCarga(page);
  const mas = page.getByRole('button', { name: `Agregar una pieza de ${producto}` });
  await mas.click();
  await mas.click();
  await expect(page.getByText('2 piezas ·')).toBeVisible();
  // Con tarjeta avisa lo que retiene Mercado Pago: $56 × 3.50 % = $1.96 + IVA $0.31.
  await page.locator('mat-button-toggle', { hasText: 'Tarjeta' }).click();
  await expect(page.getByText(/retiene \$2\.27 .*te llegan \$53\.73/)).toBeVisible();
  await page.locator('mat-button-toggle', { hasText: 'Transferencia' }).click();
  await expect(page.getByText(/retiene/)).toHaveCount(0);
  await page.locator('mat-button-toggle', { hasText: 'Tarjeta' }).click();
  await page.getByRole('button', { name: 'Registrar venta' }).click();
  const aviso = page.getByText(/Venta V-\d{6} registrada por \$56\.00/);
  await expect(aviso).toBeVisible();
  const folio = /V-\d{6}/.exec((await aviso.textContent()) ?? '')?.[0] ?? '';

  expect(await piezasDeAna(request, producto)).toBe(antes + 3);

  // 5. En su lista aparece, sin costos.
  await page.goto('/ventas');
  await esperarCarga(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Mis ventas' })).toBeVisible();
  await expect(page.getByText(/Tarjeta: \$\d/)).toBeVisible();

  // 6. El cliente regresa una pieza en buen estado: vuelve a su inventario, se le
  //    regresan sus $28 y Mercado Pago regresa la mitad de su comisión.
  await page.getByRole('link', { name: folio }).click();
  await esperarCarga(page);
  await page.getByRole('button', { name: 'Registrar devolución' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByText(/Devolver dinero/)).toBeVisible();
  await sinViolaciones(page);
  await dialogo.getByLabel('Piezas').fill('1');
  await dialogo.getByLabel('Motivo').fill('No era el sabor que pidió');
  await expect(dialogo.getByText('Se reembolsan $28.00')).toBeVisible();
  await expect(dialogo.getByText('Mercado Pago te regresa $1.14 de su comisión.')).toBeVisible();
  await dialogo.getByRole('button', { name: 'Registrar devolución' }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(page.getByText(/Devolución D-\d{6}: se reembolsan \$28\.00/)).toBeVisible();
  await expect(page.getByText('Mercado Pago regresó $1.14 de su comisión.')).toBeVisible();
  expect(await piezasDeAna(request, producto)).toBe(antes + 4);
});

test('una venta se cobra con efectivo y tarjeta a la vez', async ({ page, request }) => {
  // Se apoya en la venta de arriba: ahí quedó mercancía cargada a Ana.
  const producto = 'Galletas de Coco';
  // Escritorio y celular comparten la BD, así que se mide lo que suma esta venta.
  const cobrosDeAna = async (): Promise<Record<string, string>> =>
    (
      (await (
        await request.get('/api/reportes/corte', { headers: { 'X-Dev-Correo': USUARIOS.ana } })
      ).json()) as { cobros: Record<string, string> }
    ).cobros;
  const cobrosAntes = await cobrosDeAna();

  await entrarComo(page, 'ana');
  await page.goto('/ventas/nueva');
  await esperarCarga(page);
  const mas = page.getByRole('button', { name: `Agregar una pieza de ${producto}` });
  await mas.click();
  await mas.click();
  await expect(page.getByText('2 piezas ·')).toBeVisible();

  await page.getByRole('button', { name: 'Pagó con dos formas' }).click();
  const importe = (metodo: string) =>
    page.locator('.reparto mat-form-field', { hasText: metodo }).locator('input');
  await importe('Efectivo').fill('36');
  await expect(page.getByText(/Faltan \$20\.00/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar venta' })).toBeDisabled();

  await importe('Tarjeta').fill('20');
  await expect(page.getByText(/El pago cuadra/)).toBeVisible();
  // La comisión sale solo de los $20 de tarjeta: $0.70 + IVA = $0.81.
  await expect(page.getByText(/retiene \$0\.81/)).toBeVisible();

  await page.getByRole('button', { name: 'Registrar venta' }).click();
  const aviso = page.getByText(/Venta V-\d{6} registrada por \$56\.00/);
  await expect(aviso).toBeVisible();
  const folio = /V-\d{6}/.exec((await aviso.textContent()) ?? '')?.[0] ?? '';

  // En su lista se ven las dos formas con su importe.
  await page.goto('/ventas');
  await esperarCarga(page);
  const fila = page.getByRole('row', { name: new RegExp(folio) });
  await expect(fila).toContainText('Efectivo');
  await expect(fila).toContainText('Tarjeta');

  // Y el corte lo separa: cada peso queda contado donde entró, que es lo que tiene
  // que cuadrar con lo que trae en la bolsa y con lo que reporta la terminal.
  const despues = await cobrosDeAna();
  expect(restar(despues['efectivo'] ?? '0', cobrosAntes['efectivo'] ?? '0')).toBe('36.00');
  expect(restar(despues['tarjeta'] ?? '0', cobrosAntes['tarjeta'] ?? '0')).toBe('20.00');

  await page.goto('/corte');
  await esperarCarga(page);
  await expect(page.locator('section.tarjeta').first()).toContainText('Efectivo: $');
});

test('un vendedor no ve pantallas de otros roles', async ({ page }) => {
  await entrarComo(page, 'ana');
  await page.goto('/compras');
  await expect(page.getByRole('heading', { level: 1, name: 'Sin permiso' })).toBeVisible();
  await page.goto('/');
  await esperarCarga(page);
  const menu = page.getByRole('navigation', { name: 'Principal', includeHidden: true });
  // En el celular el menú está cerrado: se revisa lo que contiene, no si se ve.
  await expect(menu.getByRole('link', { name: 'Nueva venta', includeHidden: true })).toHaveCount(1);
  await expect(menu.getByRole('link', { name: 'Compras', includeHidden: true })).toHaveCount(0);
  await expect(menu.getByRole('link', { name: 'Usuarios', includeHidden: true })).toHaveCount(0);
});

test('se agrega una categoría y queda lista para usarse', async ({ page }, info) => {
  const categoria = `Conservas ${info.project.name}`;
  await entrarComo(page, 'admin');
  await page.goto('/productos');
  await esperarCarga(page);

  await page.getByRole('tab', { name: 'Categorías' }).click();
  await page.getByLabel('Nueva categoría').fill(categoria);
  await page.getByRole('button', { name: 'Agregar' }).click();
  await expect(page.getByText(`Categoría ${categoria} agregada.`)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: categoria })).toBeVisible();

  // Y ya se puede elegir al dar de alta un producto.
  await page.getByRole('tab', { name: 'Productos' }).click();
  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  await page.getByRole('dialog').getByRole('combobox', { name: 'Categoría' }).click();
  await expect(page.getByRole('option', { name: categoria })).toBeVisible();
});

test('el slug de un producto nuevo se genera solo y no se puede editar', async ({ page }, info) => {
  const nombre = `Galletas de Piña ${info.project.name}`;
  await entrarComo(page, 'admin');
  await page.goto('/productos');
  await esperarCarga(page);
  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo.getByRole('textbox', { name: /slug/i })).toHaveCount(0);
  await expect(dialogo.getByText('Se genera con el nombre')).toBeVisible();

  await dialogo.getByLabel('Nombre').fill(nombre);
  await expect(dialogo.getByText(`galletas-de-pina-${info.project.name}`)).toBeVisible();
  await dialogo.getByRole('combobox', { name: 'Categoría' }).click();
  await page.getByRole('option', { name: 'Galletas' }).click();
  await dialogo.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(`${nombre} guardado.`)).toBeVisible();

  // Al editarlo, el slug se ve pero sigue sin ser editable.
  await page.getByRole('button', { name: `Editar ${nombre}` }).click();
  await expect(
    page.getByRole('dialog').getByText(`galletas-de-pina-${info.project.name}`),
  ).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: /slug/i })).toHaveCount(0);
});

/** Una foto de prueba, del tamaño de las que salen de un celular. */
function foto(color: string): Promise<Buffer> {
  return sharp({ create: { width: 1600, height: 1200, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

test('la foto de un producto se sube al bucket y se ve con su ID', async ({ page }, info) => {
  // Escritorio y celular comparten la BD: cada uno usa su producto.
  const { producto, id } =
    info.project.name === 'celular'
      ? { producto: 'Galletas de Avena', id: 1 }
      : { producto: 'Galletas de Nuez', id: 4 };
  const alt = `${producto} sobre una charola`;
  await entrarComo(page, 'admin');
  await page.goto('/productos');
  await esperarCarga(page);

  // Se encuentra por su ID, el que llevará el código de barras.
  await page.getByLabel('Buscar por nombre o ID').fill(String(id));
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('rowheader', { name: new RegExp(producto) })).toBeVisible();

  await page.getByRole('button', { name: `Editar ${producto}` }).click();
  let dialogo = page.getByRole('dialog');
  await expect(dialogo.getByText('ID', { exact: true })).toBeVisible();
  await expect(dialogo.getByText('Sin imagen')).toBeVisible();

  // La foto y su texto se guardan con el mismo botón que el resto del producto.
  await dialogo.locator('input[type="file"]').setInputFiles({
    name: `foto-${info.project.name}.jpg`,
    mimeType: 'image/jpeg',
    buffer: await foto('#b5793a'),
  });
  await dialogo.getByLabel('Texto alternativo').fill(alt);
  await dialogo.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(`${producto} guardado.`)).toBeVisible();
  await expect(dialogo).toHaveCount(0);

  const miniatura = page.locator('tbody tr').first().locator('.miniatura img');
  await expect(miniatura).toHaveAttribute('src', /-600\.webp/);

  // Al reabrirlo está la foto, con su texto: quedó guardado de verdad.
  await page.getByRole('button', { name: `Editar ${producto}` }).click();
  dialogo = page.getByRole('dialog');
  await expect(dialogo.getByLabel('Texto alternativo')).toHaveValue(alt);
  const imagen = dialogo.getByRole('img', { name: alt });
  await expect(imagen).toHaveAttribute(
    'src',
    new RegExp(`/imagenes/productos/${id}/[0-9a-f]{16}-600\\.webp`),
  );
  // Se cargó de verdad desde el bucket (la política de contenido la deja pasar).
  expect(await imagen.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(600);
  await sinViolaciones(page);

  // Y se puede cambiar por otra.
  const antes = await imagen.getAttribute('src');
  await dialogo.locator('input[type="file"]').setInputFiles({
    name: `otra-${info.project.name}.jpg`,
    mimeType: 'image/jpeg',
    buffer: await foto('#3c6ec8'),
  });
  await dialogo.getByRole('button', { name: 'Guardar' }).click();
  await expect(dialogo).toHaveCount(0);
  await page.getByRole('button', { name: `Editar ${producto}` }).click();
  await expect(page.getByRole('dialog').getByRole('img', { name: alt })).not.toHaveAttribute(
    'src',
    antes ?? '',
  );
});

test('un producto nuevo se da de alta con su ficha y su foto en un solo guardado', async ({
  page,
  request,
}, info) => {
  const nombre = `Conserva de Durazno ${info.project.name}`;
  const alt = `Frasco de conserva de durazno ${info.project.name}`;
  const descripcion = 'Duraznos en almíbar ligero, en frasco de vidrio.';
  await entrarComo(page, 'admin');
  await page.goto('/productos');
  await esperarCarga(page);

  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Nombre').fill(nombre);
  await dialogo.getByRole('combobox', { name: 'Categoría' }).click();
  await page.getByRole('option', { name: 'Galletas' }).click();
  await dialogo.getByLabel('Descripción').fill(descripcion);

  const ingredientes = dialogo.locator('input[placeholder^="avena"]');
  for (const ingrediente of ['durazno', 'azúcar mascabado']) {
    await ingredientes.fill(ingrediente);
    await ingredientes.press('Enter');
    await expect(dialogo.getByRole('button', { name: `Quitar ${ingrediente}` })).toBeVisible();
  }

  await dialogo.locator('input[type="file"]').setInputFiles({
    name: `nuevo-${info.project.name}.jpg`,
    mimeType: 'image/jpeg',
    buffer: await foto('#7a8c3f'),
  });
  await dialogo.getByLabel('Texto alternativo').fill(alt);
  await dialogo.getByLabel('Publicado en el sitio').check();
  await dialogo.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(`${nombre} guardado.`)).toBeVisible();
  await expect(dialogo).toHaveCount(0);

  // Ficha y foto quedaron guardadas, sin pasos intermedios.
  await page.getByLabel('Buscar por nombre o ID').fill(nombre);
  await page.getByRole('button', { name: `Editar ${nombre}` }).click();
  const reabierto = page.getByRole('dialog');
  await expect(reabierto.getByLabel('Texto alternativo')).toHaveValue(alt);
  await expect(reabierto.getByLabel('Descripción')).toHaveValue(descripcion);
  await expect(reabierto.getByRole('button', { name: 'Quitar durazno' })).toBeVisible();
  await expect(reabierto.getByRole('img', { name: alt })).toHaveAttribute('src', /-600\.webp/);

  // Y es lo que el sitio lee, sin identidad.
  const catalogo = await (await request.get('/api/publico/catalogo')).json();
  expect(catalogo.categorias).toContain('Galletas');
  expect(catalogo.productos.find((p: { nombre: string }) => p.nombre === nombre)).toMatchObject({
    descripcion,
    ingredientes: ['durazno', 'azúcar mascabado'],
    // No se prendió el switch de la portada, así que no trae tarjeta.
    destacado: null,
  });
});

test('el texto alternativo se guarda aunque la foto llegue después', async ({ page }, info) => {
  const nombre = `Mermelada de Tejocote ${info.project.name}`;
  const alt = 'Frasco de mermelada de tejocote con la tapa de tela';
  await entrarComo(page, 'admin');
  await page.goto('/productos');
  await esperarCarga(page);

  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  await page.getByRole('dialog').getByLabel('Nombre').fill(nombre);
  await page.getByRole('dialog').getByRole('combobox', { name: 'Categoría' }).click();
  await page.getByRole('option', { name: 'Galletas' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(`${nombre} guardado.`)).toBeVisible();

  // Sin foto todavía: el texto se escribe y se guarda igual, esperándola.
  await page.getByLabel('Buscar por nombre o ID').fill(nombre);
  await page.getByRole('button', { name: `Editar ${nombre}` }).click();
  await page.getByRole('dialog').getByLabel('Texto alternativo').fill(alt);
  await page.getByRole('dialog').getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: `Editar ${nombre}` }).click();
  await expect(page.getByRole('dialog').getByLabel('Texto alternativo')).toHaveValue(alt);
});

test('las notas de un traspaso se leen desde la lista y desde el kardex', async ({
  page,
}, info) => {
  // El mismo producto del recorrido de arriba: es el que tiene piezas en el almacén.
  const producto = 'Galletas de Coco';
  const notas = `Para la feria del sábado ${info.project.name}`;
  await entrarComo(page, 'almacen');
  await page.goto('/inventario/traspasos');
  await esperarCarga(page);
  await page.getByRole('combobox', { name: 'Sale de' }).click();
  await page.getByRole('option', { name: 'Almacén' }).click();
  await page.getByRole('combobox', { name: 'Entra a' }).click();
  await page.getByRole('option', { name: 'Ana' }).click();
  await page.getByRole('combobox', { name: 'Producto' }).click();
  await page.getByRole('option', { name: new RegExp(producto) }).click();
  await page.getByLabel('Piezas').fill('2');
  await page.getByLabel('Notas (opcional)').fill(notas);
  await page.getByRole('button', { name: 'Registrar traspaso' }).click();

  // La tarjeta de la lista abre el documento completo, con sus notas.
  const tarjeta = page
    .getByRole('button', { name: /^Ver el traspaso T-/ })
    .filter({ hasText: notas })
    .first();
  await expect(tarjeta).toBeVisible();
  const folio = ((await tarjeta.getAttribute('aria-label')) ?? '').replace('Ver el traspaso ', '');
  await tarjeta.click();
  let dialogo = page.getByRole('dialog');
  await expect(dialogo.getByRole('heading', { name: `Traspaso ${folio}` })).toBeVisible();
  await expect(dialogo.getByText(notas)).toBeVisible();
  await sinViolaciones(page);
  await dialogo.getByRole('button', { name: 'Cerrar' }).click();
  await expect(dialogo).toHaveCount(0);

  // Y desde el kardex se llega al mismo documento.
  await page.goto('/inventario/kardex');
  await esperarCarga(page);
  await page.getByRole('combobox', { name: 'Producto' }).click();
  await page.getByRole('option', { name: new RegExp(producto) }).click();
  await page
    .getByRole('button', { name: `Ver ${folio}` })
    .first()
    .click();
  dialogo = page.getByRole('dialog');
  await expect(dialogo.getByText(notas)).toBeVisible();
});

test('un gasto de operación se registra y se puede cancelar', async ({ page }, info) => {
  const concepto = `Bolsas de celofán ${info.project.name}`;
  await entrarComo(page, 'admin');
  await page.goto('/gastos');
  await esperarCarga(page);

  await page.getByRole('button', { name: 'Nuevo gasto' }).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByRole('combobox', { name: 'Categoría' }).click();
  await page.getByRole('option', { name: 'Empaque' }).click();
  await dialogo.getByLabel('Concepto').fill(concepto);
  await dialogo.getByLabel('Importe').fill('240.50');
  await dialogo.getByRole('button', { name: 'Registrar gasto' }).click();
  await expect(page.getByText(/Gasto G-\d{6} registrado por \$240\.50/)).toBeVisible();

  const fila = page.getByRole('row', { name: new RegExp(concepto) });
  await expect(fila).toContainText('Empaque');
  await expect(fila).toContainText('$240.50');
  await expect(fila).toContainText('Vigente');

  // Y aparece como renglón propio en el resultado del periodo.
  await page.goto('/reportes');
  await esperarCarga(page);
  await page.getByRole('tab', { name: 'Resultado del periodo' }).click();
  const resultado = page.locator('.resultado');
  await expect(resultado).toContainText('Empaque');
  await expect(resultado).toContainText('$240.50');
  await expect(resultado).toContainText('Utilidad operativa');

  // Se cancela con motivo: deja de sumar, pero el registro se queda.
  await page.goto('/gastos');
  await esperarCarga(page);
  await fila.getByRole('button', { name: /^Cancelar el gasto/ }).click();
  const motivo = page.getByRole('dialog');
  await motivo.getByLabel('Motivo').fill('Se capturó dos veces');
  await motivo.getByRole('button', { name: 'Cancelar el gasto' }).click();
  await expect(page.getByText(/El gasto G-\d{6} quedó cancelado/)).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(concepto) })).toContainText('Cancelado');
});

test('se ve cuánto se le debe a la vendedora y se le paga desde ahí', async ({ page }, info) => {
  // 1. El admin le pone comisión a Ana.
  await entrarComo(page, 'admin');
  await page.goto('/usuarios');
  await esperarCarga(page);
  await page.getByRole('button', { name: 'Editar Ana' }).click();
  let dialogo = page.getByRole('dialog');
  await dialogo.getByLabel('Comisión por vender').fill('15');
  await dialogo.getByRole('button', { name: 'Guardar' }).click();
  await expect(dialogo).toHaveCount(0);

  // 2. Ana vende: se apoya en la mercancía que le cargaron en el recorrido de arriba.
  await entrarComo(page, 'ana');
  await page.goto('/ventas/nueva');
  await esperarCarga(page);
  await page.getByRole('button', { name: 'Agregar una pieza de Galletas de Coco' }).click();
  await page.getByRole('button', { name: 'Registrar venta' }).click();
  await expect(page.getByText(/Venta V-\d{6} registrada/)).toBeVisible();

  // 3. El admin ve cuánto le debe.
  await entrarComo(page, 'admin');
  await page.goto('/reportes');
  await esperarCarga(page);
  await page.getByRole('tab', { name: 'Comisiones' }).click();
  const fila = page.getByRole('row', { name: /^Ana / }).first();
  await expect(fila).toBeVisible();
  const saldo = (await fila.locator('.saldo').textContent())?.trim() ?? '';
  expect(saldo).toMatch(/^\$\d/);
  expect(saldo).not.toBe('$0.00');

  // 4. Le paga desde ahí: el diálogo abre con la categoría, la persona y el saldo.
  await fila.getByRole('button', { name: 'Registrar pago' }).click();
  dialogo = page.getByRole('dialog');
  await expect(dialogo.getByLabel('Concepto')).toHaveValue(/Comisión de Ana/);
  await expect(dialogo.getByRole('combobox', { name: 'Categoría' })).toContainText('Comisiones');
  await dialogo.getByRole('button', { name: 'Registrar gasto' }).click();
  await expect(page.getByText(/Pago registrado: G-\d{6}/)).toBeVisible();

  // 5. Y el saldo queda en cero.
  await expect(page.getByRole('row', { name: /^Ana / }).first().locator('.saldo')).toHaveText(
    '$0.00',
  );
  expect(info.project.name).toBeTruthy();
});

test('el menú lateral se abre y se cierra con su icono', async ({ page }, info) => {
  const celular = info.project.name === 'celular';
  await entrarComo(page, 'ana');
  await page.goto('/');
  await esperarCarga(page);
  const lateral = page.locator('mat-sidenav');
  const abrir = page.getByRole('button', { name: 'Abrir el menú' });
  const cerrar = page.getByRole('button', { name: 'Cerrar el menú' });

  if (celular) {
    // Al cargar no tapa nada: se abre solo si se toca el icono.
    await expect(lateral).toBeHidden();
    await abrir.click();
    await expect(lateral).toBeVisible();
    await expect(cerrar).toHaveAttribute('aria-expanded', 'true');
    await sinViolaciones(page);
    // Al elegir una pantalla se quita de en medio.
    await lateral.getByRole('link', { name: 'Mi mercancía' }).click();
    await esperarCarga(page);
    await expect(lateral).toBeHidden();
  } else {
    // En escritorio empieza fijo, pero se puede cerrar y se queda así.
    await expect(lateral).toBeVisible();
    await cerrar.click();
    await expect(lateral).toBeHidden();
    await page.goto('/inventario');
    await esperarCarga(page);
    await expect(lateral).toBeHidden();
    await abrir.click();
    await expect(lateral).toBeVisible();
  }
});
