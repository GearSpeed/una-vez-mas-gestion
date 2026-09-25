ALTER TABLE "gestion"."productos" ADD COLUMN "descripcion" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "gestion"."productos" ADD COLUMN "ingredientes" text[] DEFAULT '{}' NOT NULL;