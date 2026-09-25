ALTER TABLE "gestion"."usuarios" ADD COLUMN "comision_venta" numeric(6, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."ventas" ADD COLUMN "comision_vendedor_tasa" numeric(6, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."usuarios" ADD CONSTRAINT "usuarios_comision_venta" CHECK (comision_venta >= 0 and comision_venta <= 1);