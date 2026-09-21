import { expect, type APIRequestContext, test } from '@playwright/test';
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
  await page.getByRole('button', { name: 'Guardar' }).click();
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
  await page.getByRole('button', { name: 'Registrar venta' }).click();
  const aviso = page.getByText(/Venta V-\d{6} registrada por \$56\.00/);
  await expect(aviso).toBeVisible();
  const folio = /V-\d{6}/.exec((await aviso.textContent()) ?? '')?.[0] ?? '';

  expect(await piezasDeAna(request, producto)).toBe(antes + 3);

  // 5. En su lista aparece, sin costos.
  await page.goto('/ventas');
  await esperarCarga(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Mis ventas' })).toBeVisible();
  await expect(page.getByText(/Transferencia: \$\d/)).toBeVisible();

  // 6. El cliente regresa una pieza en buen estado: vuelve a su inventario.
  await page.getByRole('link', { name: folio }).click();
  await esperarCarga(page);
  await page.getByRole('button', { name: 'Registrar devolución' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  await sinViolaciones(page);
  await dialogo.getByLabel('Piezas').fill('1');
  await dialogo.getByLabel('Motivo').fill('No era el sabor que pidió');
  await expect(dialogo.getByText('Se reembolsan $28.00')).toBeVisible();
  await dialogo.getByRole('button', { name: 'Registrar devolución' }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(page.getByText(/Devolución D-\d{6}: se reembolsan \$28\.00/)).toBeVisible();
  expect(await piezasDeAna(request, producto)).toBe(antes + 4);
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
