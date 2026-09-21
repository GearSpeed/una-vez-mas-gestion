-- Escrita a mano: la vista que usan los reportes y la tasa inicial de Mercado Pago.

-- Cada línea de venta, neta de devoluciones y con la parte de la comisión de
-- tarjeta que le toca (proporcional a su importe). Las piezas que regresan al
-- inventario recuperan su costo; las que llegaron dañadas no.
CREATE VIEW gestion.venta_lineas_netas AS
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
  (CASE WHEN v.total > 0 THEN round(v.comision * d.importe / v.total, 2) ELSE 0 END)::numeric(12, 2) AS comision
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
) dv ON dv.venta_detalle_id = d.id;--> statement-breakpoint
GRANT SELECT ON gestion.venta_lineas_netas TO gestion_app;--> statement-breakpoint

-- Mercado Pago (Point y Point Tap, al contado): 3.50 % + 16 % de IVA sobre la comisión.
-- El administrador la cambia desde la app si Mercado Pago actualiza sus tarifas.
INSERT INTO gestion.comisiones_pago (metodo_pago, tasa, iva)
VALUES ('tarjeta', 0.0350, 0.1600)
ON CONFLICT (metodo_pago) DO NOTHING;
