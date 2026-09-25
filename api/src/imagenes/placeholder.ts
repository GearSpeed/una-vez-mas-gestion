/**
 * La imagen de relleno: el logo. Un producto sin foto no deja un hueco en el sitio,
 * se muestra el logo y el catálogo lo dice con `esPlaceholder`, para que el sitio
 * pueda tratarlo distinto (no indexarlo como foto del producto, por ejemplo).
 *
 * Vive en el bucket, igual que las fotos, porque quien la pide es el sitio y la
 * sirve el mismo dominio de imágenes. La API la publica al arrancar.
 */

/** Clave en el bucket, sin variante: las dos son `-1200.webp` y `-600.webp`. */
export const CLAVE_PLACEHOLDER = 'marca/logo';

/** Archivo que se publica, al lado de este módulo (`nest-cli.json` lo copia a dist). */
export const ARCHIVO_PLACEHOLDER = 'logo-producto.webp';

export const ALT_PLACEHOLDER = 'Logo de Una vez más';
