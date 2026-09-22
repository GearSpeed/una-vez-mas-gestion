ALTER TABLE "gestion"."productos" ADD COLUMN "imagen_clave" text;--> statement-breakpoint
ALTER TABLE "gestion"."productos" ADD COLUMN "imagen_alt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."productos" ADD CONSTRAINT "productos_imagen_clave" CHECK (imagen_clave ~ '^productos/[0-9]+/[0-9a-f]{16}$');--> statement-breakpoint

-- Escrito a mano: el contrato con el sitio gana el id y la imagen. Solo se agregan
-- columnas al final (ver docs/contrato-sitio.md). `imagen` e `imagen_chica` son rutas
-- dentro del bucket; el sitio les antepone la URL pública.
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
  CASE WHEN p.imagen_clave IS NULL THEN NULL ELSE p.imagen_alt END AS imagen_alt
FROM gestion.productos p
JOIN gestion.categorias c ON c.id = p.categoria_id
LEFT JOIN gestion.existencias e ON e.producto_id = p.id
LEFT JOIN gestion.ubicaciones u ON u.id = e.ubicacion_id
WHERE p.activo AND p.publicado
GROUP BY p.id, c.nombre;--> statement-breakpoint
COMMENT ON VIEW publico.catalogo IS 'Productos activos y publicados, con precio (NULL = consultar), existencia e imagen. Contrato con el back del sitio.';
