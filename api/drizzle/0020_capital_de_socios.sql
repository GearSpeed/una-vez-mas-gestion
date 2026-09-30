CREATE TYPE "gestion"."tipo_capital" AS ENUM('aportacion', 'retiro');--> statement-breakpoint
CREATE TABLE "gestion"."movimientos_capital" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."movimientos_capital_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"folio" text GENERATED ALWAYS AS ('K-' || lpad(id::text, 6, '0')) STORED NOT NULL,
	"fecha" date NOT NULL,
	"socio_id" integer NOT NULL,
	"tipo" "gestion"."tipo_capital" NOT NULL,
	"importe" numeric(12, 2) NOT NULL,
	"metodo_pago" "gestion"."metodo_pago" NOT NULL,
	"concepto" text NOT NULL,
	"notas" text DEFAULT '' NOT NULL,
	"usuario_id" integer NOT NULL,
	"clave_idempotencia" uuid NOT NULL,
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"estado" "gestion"."estado_documento" DEFAULT 'vigente' NOT NULL,
	"cancelado_en" timestamp with time zone,
	"cancelado_por" integer,
	"motivo_cancelacion" text,
	CONSTRAINT "movimientos_capital_clave_idempotencia_unica" UNIQUE("clave_idempotencia"),
	CONSTRAINT "movimientos_capital_importe" CHECK (importe > 0),
	CONSTRAINT "movimientos_capital_cancelacion" CHECK ((estado = 'cancelado') = (cancelado_en is not null))
);
--> statement-breakpoint
CREATE TABLE "gestion"."socios" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."socios_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "socios_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
ALTER TABLE "gestion"."compras" ADD COLUMN "metodo_pago" "gestion"."metodo_pago" DEFAULT 'efectivo' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."movimientos_capital" ADD CONSTRAINT "movimientos_capital_socio_id_socios_id_fk" FOREIGN KEY ("socio_id") REFERENCES "gestion"."socios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."movimientos_capital" ADD CONSTRAINT "movimientos_capital_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."movimientos_capital" ADD CONSTRAINT "movimientos_capital_cancelado_por_usuarios_id_fk" FOREIGN KEY ("cancelado_por") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movimientos_capital_fecha" ON "gestion"."movimientos_capital" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "movimientos_capital_socio" ON "gestion"."movimientos_capital" USING btree ("socio_id");