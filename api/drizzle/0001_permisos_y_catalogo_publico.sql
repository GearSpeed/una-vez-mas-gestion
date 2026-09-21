-- Permisos de los roles de Postgres (los crea db/init/01-roles.sh) y la vista
-- que lee el back del sitio. Esta migración está escrita a mano.

-- gestion_app es la API: lee, inserta y actualiza, pero no borra. El kardex
-- (movimientos) y la bitácora solo aceptan filas nuevas.
GRANT USAGE ON SCHEMA gestion TO gestion_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA gestion TO gestion_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA gestion TO gestion_app;--> statement-breakpoint
REVOKE UPDATE ON gestion.movimientos, gestion.bitacora FROM gestion_app;--> statement-breakpoint
-- Quitarle un rol a un usuario es la única baja real.
GRANT DELETE ON gestion.usuario_roles TO gestion_app;--> statement-breakpoint
-- Las tablas que agreguen migraciones futuras heredan los mismos permisos.
ALTER DEFAULT PRIVILEGES IN SCHEMA gestion GRANT SELECT, INSERT, UPDATE ON TABLES TO gestion_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA gestion GRANT USAGE, SELECT ON SEQUENCES TO gestion_app;--> statement-breakpoint

-- `publico` es lo único que ve el sitio (rol sitio_lectura). La vista corre con
-- los permisos de su dueño, así que el sitio no necesita, ni tiene, acceso a las
-- tablas: nunca ve costos, proveedores ni ventas. Es un contrato con el sitio:
-- agregar columnas está bien; quitar o renombrar una se coordina antes
-- (docs/contrato-sitio.md).
CREATE SCHEMA publico;--> statement-breakpoint
CREATE VIEW publico.catalogo AS
SELECT
  p.slug,
  p.nombre,
  c.nombre AS categoria,
  p.presentacion,
  p.precio_venta AS precio,
  COALESCE(SUM(e.cantidad), 0)::integer AS existencia_total,
  COALESCE(SUM(e.cantidad) FILTER (WHERE u.tipo = 'almacen'), 0)::integer AS existencia_almacen
FROM gestion.productos p
JOIN gestion.categorias c ON c.id = p.categoria_id
LEFT JOIN gestion.existencias e ON e.producto_id = p.id
LEFT JOIN gestion.ubicaciones u ON u.id = e.ubicacion_id
WHERE p.activo AND p.publicado
GROUP BY p.id, c.nombre;--> statement-breakpoint
COMMENT ON VIEW publico.catalogo IS 'Productos activos y publicados, con precio (NULL = consultar) y existencia. Contrato con el back del sitio.';--> statement-breakpoint
GRANT USAGE ON SCHEMA publico TO sitio_lectura;--> statement-breakpoint
GRANT SELECT ON publico.catalogo TO sitio_lectura;
