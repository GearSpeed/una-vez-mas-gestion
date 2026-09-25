CREATE TABLE "gestion"."gasto_categorias" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."gasto_categorias_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nombre" text NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	CONSTRAINT "gasto_categorias_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "gestion"."gastos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."gastos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"folio" text GENERATED ALWAYS AS ('G-' || lpad(id::text, 6, '0')) STORED NOT NULL,
	"fecha" date NOT NULL,
	"categoria_id" integer NOT NULL,
	"concepto" text NOT NULL,
	"importe" numeric(12, 2) NOT NULL,
	"metodo_pago" "gestion"."metodo_pago" NOT NULL,
	"notas" text DEFAULT '' NOT NULL,
	"usuario_id" integer NOT NULL,
	"clave_idempotencia" uuid NOT NULL,
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"estado" "gestion"."estado_documento" DEFAULT 'vigente' NOT NULL,
	"cancelado_en" timestamp with time zone,
	"cancelado_por" integer,
	"motivo_cancelacion" text,
	CONSTRAINT "gastos_clave_idempotencia_unica" UNIQUE("clave_idempotencia"),
	CONSTRAINT "gastos_importe" CHECK (importe > 0),
	CONSTRAINT "gastos_cancelacion" CHECK ((estado = 'cancelado') = (cancelado_en is not null))
);
--> statement-breakpoint
ALTER TABLE "gestion"."gastos" ADD CONSTRAINT "gastos_categoria_id_gasto_categorias_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "gestion"."gasto_categorias"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."gastos" ADD CONSTRAINT "gastos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."gastos" ADD CONSTRAINT "gastos_cancelado_por_usuarios_id_fk" FOREIGN KEY ("cancelado_por") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gastos_fecha" ON "gestion"."gastos" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "gastos_categoria" ON "gestion"."gastos" USING btree ("categoria_id");