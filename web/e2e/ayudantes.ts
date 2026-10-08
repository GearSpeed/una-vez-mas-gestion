import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const USUARIOS = {
  admin: null,
  almacen: 'almacen@demo.local',
  ana: 'ana@demo.local',
  consulta: 'consulta@demo.local',
} as const;

/** En modo desarrollo el usuario sale de localStorage (lo manda el interceptor como X-Dev-Correo). */
export async function entrarComo(page: Page, usuario: keyof typeof USUARIOS): Promise<void> {
  const correo = USUARIOS[usuario];
  await page.addInitScript((valor) => {
    if (valor) localStorage.setItem('uvm:dev-correo', valor);
    else localStorage.removeItem('uvm:dev-correo');
  }, correo);
}

/**
 * Sin violaciones de axe para WCAG 2.1 A y AA. Antes espera a que terminen las
 * animaciones: a medio camino, un mensaje de error que aparece o el fondo de un
 * diálogo que se oscurece tienen colores intermedios y axe los mide como contraste
 * insuficiente. Las animaciones infinitas (un spinner) no se esperan.
 */
export async function sinViolaciones(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) => a.playState !== 'running' || a.effect?.getComputedTiming().endTime === Infinity,
      ),
  );
  const resultado = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const resumen = resultado.violations.map((v) => ({
    regla: v.id,
    impacto: v.impact,
    ayuda: v.help,
    nodos: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
  expect(resumen, JSON.stringify(resumen, null, 2)).toEqual([]);
}

/** Espera a que la pantalla termine de cargar (sin barras de progreso). */
export async function esperarCarga(page: Page): Promise<void> {
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('mat-progress-bar')).toHaveCount(0);
}
