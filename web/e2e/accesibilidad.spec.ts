import { expect, test } from '@playwright/test';
import { entrarComo, esperarCarga, sinViolaciones, type USUARIOS } from './ayudantes';

/** Cada pantalla, con el rol que la usa, pasa axe (WCAG 2.1 AA). */
const PANTALLAS: readonly { ruta: string; usuario: keyof typeof USUARIOS }[] = [
  { ruta: '/', usuario: 'admin' },
  { ruta: '/', usuario: 'ana' },
  { ruta: '/ventas/nueva', usuario: 'ana' },
  { ruta: '/ventas', usuario: 'admin' },
  { ruta: '/corte', usuario: 'ana' },
  { ruta: '/inventario', usuario: 'ana' },
  { ruta: '/inventario', usuario: 'almacen' },
  { ruta: '/compras', usuario: 'almacen' },
  { ruta: '/compras/nueva', usuario: 'almacen' },
  { ruta: '/inventario/traspasos', usuario: 'almacen' },
  { ruta: '/inventario/ajustes', usuario: 'almacen' },
  { ruta: '/inventario/kardex?productoId=1', usuario: 'almacen' },
  { ruta: '/productos', usuario: 'admin' },
  { ruta: '/proveedores', usuario: 'admin' },
  { ruta: '/gastos', usuario: 'admin' },
  { ruta: '/capital', usuario: 'admin' },
  { ruta: '/reportes', usuario: 'admin' },
  { ruta: '/reportes', usuario: 'consulta' },
  { ruta: '/usuarios', usuario: 'admin' },
];

for (const { ruta, usuario } of PANTALLAS) {
  test(`${ruta} (${usuario}) pasa axe`, async ({ page }) => {
    await entrarComo(page, usuario);
    await page.goto(ruta);
    await esperarCarga(page);
    await sinViolaciones(page);
  });
}

/** Los diálogos también: se abren y se revisan con axe. */
const DIALOGOS: readonly { ruta: string; boton: string }[] = [
  { ruta: '/productos', boton: 'Nuevo producto' },
  { ruta: '/gastos', boton: 'Nuevo gasto' },
  { ruta: '/usuarios', boton: 'Nuevo usuario' },
  { ruta: '/proveedores', boton: 'Nuevo proveedor' },
];

for (const { ruta, boton } of DIALOGOS) {
  test(`el diálogo «${boton}» pasa axe`, async ({ page }) => {
    await entrarComo(page, 'admin');
    await page.goto(ruta);
    await esperarCarga(page);
    await page.getByRole('button', { name: boton }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await sinViolaciones(page);
  });
}

test('el diálogo de capital pasa axe', async ({ page }, info) => {
  // No está en DIALOGOS porque el botón está apagado mientras no haya un socio.
  const nombre = `Socia de prueba (${info.project.name})`;
  await entrarComo(page, 'admin');
  await page.goto('/capital');
  await esperarCarga(page);
  await page.getByRole('tab', { name: 'Socios' }).click();
  await page.getByLabel('Nuevo socio').fill(nombre);
  await page.getByRole('button', { name: 'Agregar' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: nombre })).toBeVisible();
  await page.getByRole('button', { name: 'Nuevo movimiento' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await sinViolaciones(page);
});

test('el diálogo «Editar categoría» pasa axe', async ({ page }) => {
  // No está en DIALOGOS porque se abre desde una pestaña, no desde un botón de la barra.
  await entrarComo(page, 'admin');
  await page.goto('/productos');
  await esperarCarga(page);
  await page.getByRole('tab', { name: 'Categorías' }).click();
  await page.getByRole('button', { name: 'Editar' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await sinViolaciones(page);
});

test('el calendario de un filtro de fechas pasa axe', async ({ page }) => {
  await entrarComo(page, 'admin');
  await page.goto('/ventas');
  await esperarCarga(page);
  await page.getByRole('button', { name: 'Abrir el calendario' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await sinViolaciones(page);
});

test('la pestaña «Cobro con tarjeta» pasa axe', async ({ page }) => {
  await entrarComo(page, 'admin');
  await page.goto('/productos');
  await esperarCarga(page);
  await page.getByRole('tab', { name: 'Cobro con tarjeta' }).click();
  await expect(page.getByLabel('Comisión (%)', { exact: true })).toHaveValue('3.50');
  await expect(page.getByLabel('IVA sobre la comisión (%)')).toHaveValue('16.00');
  await sinViolaciones(page);
});

test('la pestaña «Cobro con transferencia» pasa axe', async ({ page }) => {
  await entrarComo(page, 'admin');
  await page.goto('/productos');
  await esperarCarga(page);
  await page.getByRole('tab', { name: 'Cobro con transferencia' }).click();
  // Con un error a la vista, que también tiene que leerse bien.
  await page.getByLabel('CLABE', { exact: true }).fill('002180000000000013');
  await page.getByLabel('Banco', { exact: true }).click();
  await expect(page.getByText('No cuadra el dígito verificador')).toBeVisible();
  await sinViolaciones(page);
});

test('la pestaña «Simulador de venta» pasa axe', async ({ page }) => {
  // No depende de que otra prueba ya le haya puesto precio a algo: la semilla no
  // trae ninguno, así que el simulador estaría vacío sin esto.
  const producto = 'Galletas de Canela';
  await entrarComo(page, 'admin');
  await page.goto('/productos');
  await esperarCarga(page);
  await page.getByRole('button', { name: `Editar ${producto}` }).click();
  await page.getByLabel('Precio de venta').fill('30');
  const guardado = page.waitForResponse(
    (respuesta) =>
      respuesta.request().method() === 'PUT' && respuesta.url().includes('/api/productos/'),
  );
  await page.getByRole('button', { name: 'Guardar' }).click();
  await guardado;

  await page.goto('/reportes');
  await esperarCarga(page);
  await page.getByRole('tab', { name: 'Simulador de venta' }).click();
  // Con el desglose ya pintado, no solo la tabla vacía.
  await page.getByLabel(`Piezas a simular de ${producto}`).fill('2');
  await expect(page.getByText('Utilidad neta')).toBeVisible();
  await sinViolaciones(page);
});

test('el análisis de ventas de Inicio pasa axe en cada pestaña', async ({ page }) => {
  await entrarComo(page, 'admin');
  await page.goto('/');
  await esperarCarga(page);
  // Va con @defer (on viewport): hasta que se ve no carga, y el escaneo de «/» no lo cubre.
  const seccion = page.locator('uvm-analisis-ventas');
  await page.getByRole('heading', { name: 'Análisis de ventas' }).scrollIntoViewIfNeeded();
  await expect(seccion).toBeVisible();
  await expect(seccion.locator('mat-progress-bar')).toHaveCount(0);
  // Sin ventas en la BD de prueba se ve el aviso; con ventas (las del flujo), las pestañas.
  const pestanas = seccion.getByRole('tab');
  if ((await pestanas.count()) === 0) {
    await expect(seccion.getByText('Todavía no hay ventas')).toBeVisible();
    await sinViolaciones(page);
    return;
  }
  for (const nombre of ['Resumen', 'Orden de agotamiento', 'Por mes', 'Por año', 'Por día']) {
    await seccion.getByRole('tab', { name: nombre }).click();
    await sinViolaciones(page);
  }
});
