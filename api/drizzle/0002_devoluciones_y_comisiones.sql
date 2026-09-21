ALTER TYPE "gestion"."tipo_movimiento" ADD VALUE 'devolucion';--> statement-breakpoint
CREATE TABLE "gestion"."comisiones_pago" (
	"metodo_pago" "gestion"."metodo_pago" PRIMARY KEY NOT NULL,
	"tasa" numeric(6, 4) NOT NULL,
	"iva" numeric(6, 4) NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comisiones_pago_tasa" CHECK (tasa >= 0 and tasa < 1),
	CONSTRAINT "comisiones_pago_iva" CHECK (iva >= 0 and iva < 1)
);
--> statement-breakpoint
CREATE TABLE "gestion"."devolucion_detalle" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."devolucion_detalle_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"devolucion_id" integer NOT NULL,
	"venta_detalle_id" integer NOT NULL,
	"producto_id" integer NOT NULL,
	"cantidad" integer NOT NULL,
	"regresa_a_inventario" boolean NOT NULL,
	"reembolso" numeric(12, 2) NOT NULL,
	CONSTRAINT "devolucion_detalle_linea_unica" UNIQUE("devolucion_id","venta_detalle_id"),
	CONSTRAINT "devolucion_detalle_cantidad" CHECK (cantidad > 0),
	CONSTRAINT "devolucion_detalle_reembolso" CHECK (reembolso >= 0)
);
--> statement-breakpoint
CREATE TABLE "gestion"."devoluciones" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."devoluciones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"folio" text GENERATED ALWAYS AS ('D-' || lpad(id::text, 6, '0')) STORED NOT NULL,
	"fecha" date NOT NULL,
	"venta_id" integer NOT NULL,
	"motivo" text NOT NULL,
	"reembolso" numeric(12, 2) NOT NULL,
	"usuario_id" integer NOT NULL,
	"clave_idempotencia" uuid NOT NULL,
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devoluciones_clave_idempotencia_unica" UNIQUE("clave_idempotencia"),
	CONSTRAINT "devoluciones_reembolso" CHECK (reembolso >= 0)
);
--> statement-breakpoint
ALTER TABLE "gestion"."movimientos" DROP CONSTRAINT "movimientos_un_documento";--> statement-breakpoint
ALTER TABLE "gestion"."movimientos" ADD COLUMN "devolucion_id" integer;--> statement-breakpoint
ALTER TABLE "gestion"."ventas" ADD COLUMN "comision" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."devolucion_detalle" ADD CONSTRAINT "devolucion_detalle_devolucion_id_devoluciones_id_fk" FOREIGN KEY ("devolucion_id") REFERENCES "gestion"."devoluciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."devolucion_detalle" ADD CONSTRAINT "devolucion_detalle_venta_detalle_id_venta_detalle_id_fk" FOREIGN KEY ("venta_detalle_id") REFERENCES "gestion"."venta_detalle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."devolucion_detalle" ADD CONSTRAINT "devolucion_detalle_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "gestion"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."devoluciones" ADD CONSTRAINT "devoluciones_venta_id_ventas_id_fk" FOREIGN KEY ("venta_id") REFERENCES "gestion"."ventas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."devoluciones" ADD CONSTRAINT "devoluciones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devolucion_detalle_linea" ON "gestion"."devolucion_detalle" USING btree ("venta_detalle_id");--> statement-breakpoint
CREATE INDEX "devoluciones_venta" ON "gestion"."devoluciones" USING btree ("venta_id");--> statement-breakpoint
CREATE INDEX "devoluciones_fecha" ON "gestion"."devoluciones" USING btree ("fecha");--> statement-breakpoint
ALTER TABLE "gestion"."movimientos" ADD CONSTRAINT "movimientos_devolucion_id_devoluciones_id_fk" FOREIGN KEY ("devolucion_id") REFERENCES "gestion"."devoluciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."movimientos" ADD CONSTRAINT "movimientos_un_documento" CHECK (num_nonnulls(compra_id, venta_id, traspaso_id, ajuste_id, devolucion_id) = 1);--> statement-breakpoint
ALTER TABLE "gestion"."ventas" ADD CONSTRAINT "ventas_comision" CHECK (comision >= 0 and comision <= total);