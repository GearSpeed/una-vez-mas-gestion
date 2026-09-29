ALTER TABLE "gestion"."categorias" ADD COLUMN "titulo" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."categorias" ADD COLUMN "insignia" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."categorias" ADD COLUMN "insignia_icono" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."categorias" ADD COLUMN "descripcion" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."categorias" ADD COLUMN "cta" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."categorias" ADD COLUMN "imagen_clave" text;--> statement-breakpoint
ALTER TABLE "gestion"."categorias" ADD COLUMN "imagen_alt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."categorias" ADD CONSTRAINT "categorias_imagen_clave" CHECK (imagen_clave ~ '^categorias/[0-9]+/[0-9a-f]{16}$');