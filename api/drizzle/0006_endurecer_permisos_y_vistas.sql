-- Escrita a mano: endurecimiento de permisos antes de salir a internet.
-- Ver docs/seguridad.md.

-- 1. Los permisos por omisión ya no reparten escritura. Antes, cualquier vista o
--    tabla nueva nacía con INSERT/UPDATE para gestion_app; una vista simple sobre
--    `movimientos` habría devuelto el UPDATE que la 0001 revoca, y el kardex dejaría
--    de ser inmutable. Cada migración concede la escritura tabla por tabla.
ALTER DEFAULT PRIVILEGES IN SCHEMA gestion REVOKE INSERT, UPDATE ON TABLES FROM gestion_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA gestion GRANT SELECT ON TABLES TO gestion_app;--> statement-breakpoint

-- 2. Las vistas de `gestion` corren con los permisos de quien consulta: nunca pueden
--    dar más de lo que el rol ya tiene sobre las tablas. (La de `publico` no: ahí el
--    comportamiento de dueño es justo lo que sostiene el contrato con el sitio.)
ALTER VIEW gestion.venta_lineas_netas SET (security_invoker = true);--> statement-breakpoint
REVOKE INSERT, UPDATE ON gestion.venta_lineas_netas FROM gestion_app;--> statement-breakpoint

-- 3. Defensa en profundidad: nadie crea objetos en `public` (PostgreSQL 15+ ya lo
--    trae así, pero las bases restauradas desde template1 no).
REVOKE ALL ON SCHEMA public FROM PUBLIC;--> statement-breakpoint

-- 4. El sitio deja de recibir la existencia exacta: con el número se puede medir el
--    ritmo de venta del negocio. `existencia_total` y `existencia_almacen` quedan
--    como obsoletas y se retiran cuando el sitio use la ruta HTTP del catálogo
--    (docs/contrato-sitio.md).
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
  END AS disponibilidad
FROM gestion.productos p
JOIN gestion.categorias c ON c.id = p.categoria_id
LEFT JOIN gestion.existencias e ON e.producto_id = p.id
LEFT JOIN gestion.ubicaciones u ON u.id = e.ubicacion_id
WHERE p.activo AND p.publicado
GROUP BY p.id, c.nombre;--> statement-breakpoint

-- 6. Con barrera: el filtro de productos activos y publicados se evalúa antes que
--    cualquier condición que mande quien consulta. Va al final porque un
--    CREATE OR REPLACE VIEW borra las opciones de la vista.
ALTER VIEW publico.catalogo SET (security_barrier = true);
