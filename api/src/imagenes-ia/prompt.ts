/**
 * El prompt que se manda a OpenAI. La referencia va como imagen 1 y la foto del
 * producto como imagen 2; lo fijo le dice al modelo qué es cada una y que no
 * invente nada del producto, que es lo que se vende y tiene que verse como es.
 */
export function armarPrompt(promptReferencia: string, promptExtra: string): string {
  const partes = [
    'Imagen 1: referencia de la escena (fondo, superficie, luz, composición y estilo).',
    'Imagen 2: foto real del producto.',
    'Crea una fotografía de producto profesional con el producto de la imagen 2 dentro de ' +
      'la escena de la imagen 1. Conserva el producto idéntico: forma, empaque, etiqueta, ' +
      'textos, colores y proporciones. No inventes textos, logotipos ni productos que no ' +
      'estén en la imagen 2.',
    `La escena: ${promptReferencia.trim()}`,
  ];
  const extra = promptExtra.trim();
  if (extra) partes.push(`Además: ${extra}`);
  return partes.join('\n');
}
