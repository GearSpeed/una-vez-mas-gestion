ALTER TABLE "gestion"."devoluciones" ADD COLUMN "comision_devuelta" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."devoluciones" ADD CONSTRAINT "devoluciones_comision_devuelta" CHECK (comision_devuelta >= 0);--> statement-breakpoint

-- Escrito a mano: la comisión de cada línea ya sin lo que la entidad regresó en
-- devoluciones. Como regresa la parte proporcional a lo reembolsado, a cada línea le
-- toca la comisión de la venta en proporción a su importe neto.
CREATE OR REPLACE VIEW gestion.venta_lineas_netas AS
SELECT
  d.id,
  d.venta_id,
  d.producto_id,
  d.cantidad,
  d.importe,
  d.costo_unitario,
  COALESCE(dv.devueltas, 0)::integer AS devueltas,
  COALESCE(dv.regresadas, 0)::integer AS regresadas,
  COALESCE(dv.reembolsado, 0)::numeric(12, 2) AS reembolsado,
  (d.cantidad - COALESCE(dv.devueltas, 0))::integer AS piezas_netas,
  (d.importe - COALESCE(dv.reembolsado, 0))::numeric(12, 2) AS importe_neto,
  ((d.cantidad - COALESCE(dv.regresadas, 0)) * d.costo_unitario)::numeric(14, 6) AS costo_neto,
  (CASE WHEN v.total > 0
    THEN round(v.comision * (d.importe - COALESCE(dv.reembolsado, 0)) / v.total, 2)
    ELSE 0 END)::numeric(12, 2) AS comision
FROM gestion.venta_detalle d
JOIN gestion.ventas v ON v.id = d.venta_id
LEFT JOIN (
  SELECT
    venta_detalle_id,
    sum(cantidad) AS devueltas,
    sum(cantidad) FILTER (WHERE regresa_a_inventario) AS regresadas,
    sum(reembolso) AS reembolsado
  FROM gestion.devolucion_detalle
  GROUP BY venta_detalle_id
) dv ON dv.venta_detalle_id = d.id;
