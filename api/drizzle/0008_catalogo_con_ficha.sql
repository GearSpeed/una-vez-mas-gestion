-- Escrita a mano: la vista del sitio gana la ficha del producto (descripción e
-- ingredientes destacados). Ver docs/contrato-sitio.md.
--
-- Las columnas nuevas ya existen (migración 0007). Aquí solo se rehace la vista,
-- que es el contrato con el back del sitio.
--
-- Las dos van al FINAL de la lista, aunque su lugar natural sería junto a
-- `presentacion`: PostgreSQL solo deja agregar columnas al final en un
-- `CREATE OR REPLACE VIEW`. Ponerlas en medio sería renombrar las que siguen, y
-- eso lo rechaza. Reordenar exigiría DROP + CREATE y volver a conceder el SELECT
-- de `sitio_lectura`: no vale el riesgo por un orden de columnas.
CREATE OR REPLACE VIEW publico.catalogo AS
SELECT
  p.slug,
  p.nombre,
  c.nombre AS categoria,
  p.presentacion,
  p.precio_venta AS precio,
  COALESCE(SUM(e.cantidad), 0)::integer AS existencia_total,
  COALESCE(SUM(e.cantidad) FILTER (WHERE u.tipo = 'almacen'), 0)::integer AS existencia_almacen,
  p.id,
  p.imagen_clave || '-1200.webp' AS imagen,
  p.imagen_clave || '-600.webp' AS imagen_chica,
  CASE WHEN p.imagen_clave IS NULL THEN NULL ELSE p.imagen_alt END AS imagen_alt,
  CASE
    WHEN COALESCE(SUM(e.cantidad), 0) <= 0 THEN 'agotado'
    WHEN COALESCE(SUM(e.cantidad), 0) <= 5 THEN 'ultimas_piezas'
    ELSE 'disponible'
  END AS disponibilidad,
  p.descripcion,
  p.ingredientes
FROM gestion.productos p
JOIN gestion.categorias c ON c.id = p.categoria_id
LEFT JOIN gestion.existencias e ON e.producto_id = p.id
LEFT JOIN gestion.ubicaciones u ON u.id = e.ubicacion_id
WHERE p.activo AND p.publicado
GROUP BY p.id, c.nombre;--> statement-breakpoint

-- Igual que en la 0006: `CREATE OR REPLACE VIEW` borra las opciones de la vista, así
-- que la barrera se vuelve a poner al final.
ALTER VIEW publico.catalogo SET (security_barrier = true);
