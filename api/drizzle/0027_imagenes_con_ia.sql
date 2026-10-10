CREATE TYPE "gestion"."calidad_imagen_ia" AS ENUM('baja', 'media', 'alta');--> statement-breakpoint
CREATE TYPE "gestion"."error_imagen_ia" AS ENUM('sin_creditos', 'limite', 'llave', 'moderacion', 'servicio');--> statement-breakpoint
CREATE TYPE "gestion"."estado_generacion" AS ENUM('generando', 'lista', 'error', 'asignada', 'descartada');--> statement-breakpoint
CREATE TABLE "gestion"."imagenes_generadas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."imagenes_generadas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"referencia_id" integer NOT NULL,
	"foto" "bytea",
	"prompt_extra" text DEFAULT '' NOT NULL,
	"prompt" text NOT NULL,
	"calidad" "gestion"."calidad_imagen_ia" NOT NULL,
	"modelo" text NOT NULL,
	"estado" "gestion"."estado_generacion" DEFAULT 'generando' NOT NULL,
	"error_tipo" "gestion"."error_imagen_ia",
	"error_mensaje" text,
	"resultado" "bytea",
	"producto_id" integer,
	"creado_por" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"terminado_en" timestamp with time zone,
	CONSTRAINT "imagenes_generadas_error" CHECK ((estado = 'error') = (error_tipo is not null and error_mensaje is not null)),
	CONSTRAINT "imagenes_generadas_producto" CHECK ((estado = 'asignada') = (producto_id is not null))
);
--> statement-breakpoint
CREATE TABLE "gestion"."referencias_imagen" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."referencias_imagen_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nombre" text NOT NULL,
	"prompt" text NOT NULL,
	"imagen" "bytea" NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gestion"."imagenes_generadas" ADD CONSTRAINT "imagenes_generadas_referencia_id_referencias_imagen_id_fk" FOREIGN KEY ("referencia_id") REFERENCES "gestion"."referencias_imagen"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."imagenes_generadas" ADD CONSTRAINT "imagenes_generadas_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "gestion"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."imagenes_generadas" ADD CONSTRAINT "imagenes_generadas_creado_por_usuarios_id_fk" FOREIGN KEY ("creado_por") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imagenes_generadas_creado_en" ON "gestion"."imagenes_generadas" USING btree ("creado_en");