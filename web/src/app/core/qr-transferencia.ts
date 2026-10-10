import type { PosicionQr } from '@uvm/compartido';
import { imagenConSesion } from './imagen-con-sesion';

/**
 * Un QR de transferencia como URL local (`blob:`): la ruta exige sesión. Se llama en
 * el contexto de inyección.
 *
 * @param posicion cuál pedir; con null no se hace la petición (respondería 404).
 */
export function qrDeTransferencia(posicion: () => PosicionQr | null) {
  return imagenConSesion(() => {
    const p = posicion();
    return p ? `/api/transferencia/qr/${p}` : null;
  });
}
