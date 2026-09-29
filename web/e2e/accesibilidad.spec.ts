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
