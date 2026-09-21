CREATE SCHEMA "gestion";
--> statement-breakpoint
CREATE TYPE "gestion"."canal_venta" AS ENUM('whatsapp', 'presencial', 'evento', 'otro');--> statement-breakpoint
CREATE TYPE "gestion"."estado_documento" AS ENUM('vigente', 'cancelado');--> statement-breakpoint
CREATE TYPE "gestion"."metodo_pago" AS ENUM('efectivo', 'transferencia', 'tarjeta', 'otro');--> statement-breakpoint
CREATE TYPE "gestion"."motivo_ajuste" AS ENUM('merma', 'caducidad', 'danado', 'muestra', 'conteo', 'otro');--> statement-breakpoint
CREATE TYPE "gestion"."tipo_movimiento" AS ENUM('compra', 'venta', 'traspaso_salida', 'traspaso_entrada', 'ajuste', 'cancelacion_compra', 'cancelacion_venta');--> statement-breakpoint
CREATE TYPE "gestion"."tipo_ubicacion" AS ENUM('almacen', 'vendedor');--> statement-breakpoint
CREATE TABLE "gestion"."ajuste_detalle" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."ajuste_detalle_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"ajuste_id" integer NOT NULL,
	"producto_id" integer NOT NULL,
	"cantidad" integer NOT NULL,
	"costo_unitario" numeric(14, 6) NOT NULL,
	CONSTRAINT "ajuste_detalle_producto_unico" UNIQUE("ajuste_id","producto_id"),
	CONSTRAINT "ajuste_detalle_cantidad" CHECK (cantidad <> 0)
);
--> statement-breakpoint
CREATE TABLE "gestion"."ajustes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."ajustes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"folio" text GENERATED ALWAYS AS ('A-' || lpad(id::text, 6, '0')) STORED NOT NULL,
	"fecha" date NOT NULL,
	"ubicacion_id" integer NOT NULL,
	"motivo" "gestion"."motivo_ajuste" NOT NULL,
	"notas" text DEFAULT '' NOT NULL,
	"usuario_id" integer NOT NULL,
	"clave_idempotencia" uuid NOT NULL,
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ajustes_clave_idempotencia_unica" UNIQUE("clave_idempotencia")
);
--> statement-breakpoint
CREATE TABLE "gestion"."bitacora" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."bitacora_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" integer,
	"accion" text NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" text NOT NULL,
	"datos" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gestion"."categorias" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."categorias_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nombre" text NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	"activa" boolean DEFAULT true NOT NULL,
	CONSTRAINT "categorias_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "gestion"."compra_detalle" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."compra_detalle_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"compra_id" integer NOT NULL,
	"producto_id" integer NOT NULL,
	"cantidad" integer NOT NULL,
	"costo_proveedor" numeric(12, 2) NOT NULL,
	"costo_traslado_unitario" numeric(14, 6) NOT NULL,
	"costo_unitario" numeric(14, 6) NOT NULL,
	CONSTRAINT "compra_detalle_producto_unico" UNIQUE("compra_id","producto_id"),
	CONSTRAINT "compra_detalle_cantidad" CHECK (cantidad > 0),
	CONSTRAINT "compra_detalle_costo" CHECK (costo_proveedor >= 0)
);
--> statement-breakpoint
CREATE TABLE "gestion"."compras" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."compras_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"folio" text GENERATED ALWAYS AS ('C-' || lpad(id::text, 6, '0')) STORED NOT NULL,
	"fecha" date NOT NULL,
	"proveedor_id" integer NOT NULL,
	"vehiculo_id" integer,
	"ubicacion_id" integer NOT NULL,
	"precio_gasolina" numeric(8, 2),
	"distancia_km" numeric(7, 2),
	"rendimiento_km_l" numeric(6, 2),
	"costo_traslado" numeric(12, 2) NOT NULL,
	"subtotal_mercancia" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"piezas" integer NOT NULL,
	"notas" text DEFAULT '' NOT NULL,
	"usuario_id" integer NOT NULL,
	"clave_idempotencia" uuid NOT NULL,
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"estado" "gestion"."estado_documento" DEFAULT 'vigente' NOT NULL,
	"cancelado_en" timestamp with time zone,
	"cancelado_por" integer,
	"motivo_cancelacion" text,
	CONSTRAINT "compras_clave_idempotencia_unica" UNIQUE("clave_idempotencia"),
	CONSTRAINT "compras_viaje_completo" CHECK ((vehiculo_id is null) = (precio_gasolina is null)
        and (vehiculo_id is null) = (distancia_km is null)
        and (vehiculo_id is null) = (rendimiento_km_l is null)),
	CONSTRAINT "compras_cancelacion" CHECK ((estado = 'cancelado') = (cancelado_en is not null))
);
--> statement-breakpoint
CREATE TABLE "gestion"."existencias" (
	"producto_id" integer NOT NULL,
	"ubicacion_id" integer NOT NULL,
	"cantidad" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "existencias_producto_id_ubicacion_id_pk" PRIMARY KEY("producto_id","ubicacion_id"),
	CONSTRAINT "existencias_no_negativas" CHECK (cantidad >= 0)
);
--> statement-breakpoint
CREATE TABLE "gestion"."movimientos" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."movimientos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"fecha" date NOT NULL,
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"producto_id" integer NOT NULL,
	"ubicacion_id" integer NOT NULL,
	"tipo" "gestion"."tipo_movimiento" NOT NULL,
	"cantidad" integer NOT NULL,
	"costo_unitario" numeric(14, 6) NOT NULL,
	"existencia_resultante" integer NOT NULL,
	"costo_promedio_resultante" numeric(14, 6) NOT NULL,
	"usuario_id" integer NOT NULL,
	"compra_id" integer,
	"venta_id" integer,
	"traspaso_id" integer,
	"ajuste_id" integer,
	CONSTRAINT "movimientos_cantidad" CHECK (cantidad <> 0),
	CONSTRAINT "movimientos_un_documento" CHECK (num_nonnulls(compra_id, venta_id, traspaso_id, ajuste_id) = 1)
);
--> statement-breakpoint
CREATE TABLE "gestion"."productos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."productos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"nombre" text NOT NULL,
	"categoria_id" integer NOT NULL,
	"variedad" text DEFAULT '' NOT NULL,
	"presentacion" text,
	"precio_venta" numeric(12, 2),
	"ganancia_objetivo" numeric(6, 4),
	"costo_promedio" numeric(14, 6) DEFAULT '0' NOT NULL,
	"stock_minimo" integer DEFAULT 0 NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"publicado" boolean DEFAULT false NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "productos_slug_unique" UNIQUE("slug"),
	CONSTRAINT "productos_slug_formato" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "productos_precio_venta" CHECK (precio_venta >= 0),
	CONSTRAINT "productos_ganancia_objetivo" CHECK (ganancia_objetivo >= 0),
	CONSTRAINT "productos_costo_promedio" CHECK (costo_promedio >= 0),
	CONSTRAINT "productos_stock_minimo" CHECK (stock_minimo >= 0)
);
--> statement-breakpoint
CREATE TABLE "gestion"."proveedores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."proveedores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nombre" text NOT NULL,
	"contacto" text DEFAULT '' NOT NULL,
	"telefono" text DEFAULT '' NOT NULL,
	"distancia_km" numeric(7, 2) DEFAULT '0' NOT NULL,
	"categorias_que_surte" text DEFAULT '' NOT NULL,
	"notas" text DEFAULT '' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proveedores_nombre_unique" UNIQUE("nombre"),
	CONSTRAINT "proveedores_distancia" CHECK (distancia_km >= 0)
);
--> statement-breakpoint
CREATE TABLE "gestion"."rol_permisos" (
	"rol_id" integer NOT NULL,
	"permiso" text NOT NULL,
	CONSTRAINT "rol_permisos_rol_id_permiso_pk" PRIMARY KEY("rol_id","permiso")
);
--> statement-breakpoint
CREATE TABLE "gestion"."roles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"clave" text NOT NULL,
	"nombre" text NOT NULL,
	"descripcion" text DEFAULT '' NOT NULL,
	CONSTRAINT "roles_clave_unique" UNIQUE("clave")
);
--> statement-breakpoint
CREATE TABLE "gestion"."traspaso_detalle" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."traspaso_detalle_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"traspaso_id" integer NOT NULL,
	"producto_id" integer NOT NULL,
	"cantidad" integer NOT NULL,
	CONSTRAINT "traspaso_detalle_producto_unico" UNIQUE("traspaso_id","producto_id"),
	CONSTRAINT "traspaso_detalle_cantidad" CHECK (cantidad > 0)
);
--> statement-breakpoint
CREATE TABLE "gestion"."traspasos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."traspasos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"folio" text GENERATED ALWAYS AS ('T-' || lpad(id::text, 6, '0')) STORED NOT NULL,
	"fecha" date NOT NULL,
	"origen_id" integer NOT NULL,
	"destino_id" integer NOT NULL,
	"notas" text DEFAULT '' NOT NULL,
	"usuario_id" integer NOT NULL,
	"clave_idempotencia" uuid NOT NULL,
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "traspasos_clave_idempotencia_unica" UNIQUE("clave_idempotencia"),
	CONSTRAINT "traspasos_origen_destino" CHECK (origen_id <> destino_id)
);
--> statement-breakpoint
CREATE TABLE "gestion"."ubicaciones" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."ubicaciones_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nombre" text NOT NULL,
	"tipo" "gestion"."tipo_ubicacion" NOT NULL,
	"usuario_id" integer,
	"activa" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ubicaciones_nombre_unique" UNIQUE("nombre"),
	CONSTRAINT "ubicaciones_usuario_unico" UNIQUE("usuario_id"),
	CONSTRAINT "ubicaciones_vendedor_con_usuario" CHECK ((tipo = 'vendedor') = (usuario_id is not null))
);
--> statement-breakpoint
CREATE TABLE "gestion"."usuario_roles" (
	"usuario_id" integer NOT NULL,
	"rol_id" integer NOT NULL,
	CONSTRAINT "usuario_roles_usuario_id_rol_id_pk" PRIMARY KEY("usuario_id","rol_id")
);
--> statement-breakpoint
CREATE TABLE "gestion"."usuarios" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."usuarios_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"correo" text NOT NULL,
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"ultimo_acceso" timestamp with time zone,
	CONSTRAINT "usuarios_correo_unique" UNIQUE("correo"),
	CONSTRAINT "usuarios_correo_minusculas" CHECK (correo = lower(correo))
);
--> statement-breakpoint
CREATE TABLE "gestion"."vehiculos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."vehiculos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"nombre" text NOT NULL,
	"rendimiento_km_l" numeric(6, 2) NOT NULL,
	"notas" text DEFAULT '' NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehiculos_nombre_unique" UNIQUE("nombre"),
	CONSTRAINT "vehiculos_rendimiento" CHECK (rendimiento_km_l > 0)
);
--> statement-breakpoint
CREATE TABLE "gestion"."venta_detalle" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."venta_detalle_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"venta_id" integer NOT NULL,
	"producto_id" integer NOT NULL,
	"cantidad" integer NOT NULL,
	"precio_unitario" numeric(12, 2) NOT NULL,
	"descuento" numeric(12, 2) DEFAULT '0' NOT NULL,
	"importe" numeric(12, 2) GENERATED ALWAYS AS (cantidad * precio_unitario - descuento) STORED NOT NULL,
	"costo_unitario" numeric(14, 6) NOT NULL,
	CONSTRAINT "venta_detalle_producto_unico" UNIQUE("venta_id","producto_id"),
	CONSTRAINT "venta_detalle_cantidad" CHECK (cantidad > 0),
	CONSTRAINT "venta_detalle_precio" CHECK (precio_unitario >= 0),
	CONSTRAINT "venta_detalle_descuento" CHECK (descuento >= 0 and descuento <= cantidad * precio_unitario)
);
--> statement-breakpoint
CREATE TABLE "gestion"."ventas" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gestion"."ventas_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"folio" text GENERATED ALWAYS AS ('V-' || lpad(id::text, 6, '0')) STORED NOT NULL,
	"fecha" date NOT NULL,
	"ubicacion_id" integer NOT NULL,
	"vendedor_id" integer NOT NULL,
	"canal" "gestion"."canal_venta" NOT NULL,
	"metodo_pago" "gestion"."metodo_pago" NOT NULL,
	"piezas" integer NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"notas" text DEFAULT '' NOT NULL,
	"clave_idempotencia" uuid NOT NULL,
	"registrado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"estado" "gestion"."estado_documento" DEFAULT 'vigente' NOT NULL,
	"cancelado_en" timestamp with time zone,
	"cancelado_por" integer,
	"motivo_cancelacion" text,
	CONSTRAINT "ventas_clave_idempotencia_unica" UNIQUE("clave_idempotencia"),
	CONSTRAINT "ventas_total" CHECK (total >= 0),
	CONSTRAINT "ventas_cancelacion" CHECK ((estado = 'cancelado') = (cancelado_en is not null))
);
--> statement-breakpoint
ALTER TABLE "gestion"."ajuste_detalle" ADD CONSTRAINT "ajuste_detalle_ajuste_id_ajustes_id_fk" FOREIGN KEY ("ajuste_id") REFERENCES "gestion"."ajustes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."ajuste_detalle" ADD CONSTRAINT "ajuste_detalle_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "gestion"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."ajustes" ADD CONSTRAINT "ajustes_ubicacion_id_ubicaciones_id_fk" FOREIGN KEY ("ubicacion_id") REFERENCES "gestion"."ubicaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."ajustes" ADD CONSTRAINT "ajustes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."bitacora" ADD CONSTRAINT "bitacora_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."compra_detalle" ADD CONSTRAINT "compra_detalle_compra_id_compras_id_fk" FOREIGN KEY ("compra_id") REFERENCES "gestion"."compras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."compra_detalle" ADD CONSTRAINT "compra_detalle_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "gestion"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."compras" ADD CONSTRAINT "compras_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "gestion"."proveedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."compras" ADD CONSTRAINT "compras_vehiculo_id_vehiculos_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "gestion"."vehiculos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."compras" ADD CONSTRAINT "compras_ubicacion_id_ubicaciones_id_fk" FOREIGN KEY ("ubicacion_id") REFERENCES "gestion"."ubicaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."compras" ADD CONSTRAINT "compras_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."compras" ADD CONSTRAINT "compras_cancelado_por_usuarios_id_fk" FOREIGN KEY ("cancelado_por") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."existencias" ADD CONSTRAINT "existencias_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "gestion"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."existencias" ADD CONSTRAINT "existencias_ubicacion_id_ubicaciones_id_fk" FOREIGN KEY ("ubicacion_id") REFERENCES "gestion"."ubicaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."movimientos" ADD CONSTRAINT "movimientos_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "gestion"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."movimientos" ADD CONSTRAINT "movimientos_ubicacion_id_ubicaciones_id_fk" FOREIGN KEY ("ubicacion_id") REFERENCES "gestion"."ubicaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."movimientos" ADD CONSTRAINT "movimientos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."movimientos" ADD CONSTRAINT "movimientos_compra_id_compras_id_fk" FOREIGN KEY ("compra_id") REFERENCES "gestion"."compras"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."movimientos" ADD CONSTRAINT "movimientos_venta_id_ventas_id_fk" FOREIGN KEY ("venta_id") REFERENCES "gestion"."ventas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."movimientos" ADD CONSTRAINT "movimientos_traspaso_id_traspasos_id_fk" FOREIGN KEY ("traspaso_id") REFERENCES "gestion"."traspasos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."movimientos" ADD CONSTRAINT "movimientos_ajuste_id_ajustes_id_fk" FOREIGN KEY ("ajuste_id") REFERENCES "gestion"."ajustes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."productos" ADD CONSTRAINT "productos_categoria_id_categorias_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "gestion"."categorias"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."rol_permisos" ADD CONSTRAINT "rol_permisos_rol_id_roles_id_fk" FOREIGN KEY ("rol_id") REFERENCES "gestion"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."traspaso_detalle" ADD CONSTRAINT "traspaso_detalle_traspaso_id_traspasos_id_fk" FOREIGN KEY ("traspaso_id") REFERENCES "gestion"."traspasos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."traspaso_detalle" ADD CONSTRAINT "traspaso_detalle_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "gestion"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."traspasos" ADD CONSTRAINT "traspasos_origen_id_ubicaciones_id_fk" FOREIGN KEY ("origen_id") REFERENCES "gestion"."ubicaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."traspasos" ADD CONSTRAINT "traspasos_destino_id_ubicaciones_id_fk" FOREIGN KEY ("destino_id") REFERENCES "gestion"."ubicaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."traspasos" ADD CONSTRAINT "traspasos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."ubicaciones" ADD CONSTRAINT "ubicaciones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."usuario_roles" ADD CONSTRAINT "usuario_roles_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."usuario_roles" ADD CONSTRAINT "usuario_roles_rol_id_roles_id_fk" FOREIGN KEY ("rol_id") REFERENCES "gestion"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."venta_detalle" ADD CONSTRAINT "venta_detalle_venta_id_ventas_id_fk" FOREIGN KEY ("venta_id") REFERENCES "gestion"."ventas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."venta_detalle" ADD CONSTRAINT "venta_detalle_producto_id_productos_id_fk" FOREIGN KEY ("producto_id") REFERENCES "gestion"."productos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."ventas" ADD CONSTRAINT "ventas_ubicacion_id_ubicaciones_id_fk" FOREIGN KEY ("ubicacion_id") REFERENCES "gestion"."ubicaciones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."ventas" ADD CONSTRAINT "ventas_vendedor_id_usuarios_id_fk" FOREIGN KEY ("vendedor_id") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gestion"."ventas" ADD CONSTRAINT "ventas_cancelado_por_usuarios_id_fk" FOREIGN KEY ("cancelado_por") REFERENCES "gestion"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ajustes_fecha" ON "gestion"."ajustes" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "bitacora_entidad" ON "gestion"."bitacora" USING btree ("entidad","entidad_id");--> statement-breakpoint
CREATE INDEX "compras_fecha" ON "gestion"."compras" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "movimientos_producto" ON "gestion"."movimientos" USING btree ("producto_id","id");--> statement-breakpoint
CREATE INDEX "movimientos_ubicacion_producto" ON "gestion"."movimientos" USING btree ("ubicacion_id","producto_id","id");--> statement-breakpoint
CREATE INDEX "movimientos_fecha" ON "gestion"."movimientos" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "movimientos_compra" ON "gestion"."movimientos" USING btree ("compra_id");--> statement-breakpoint
CREATE INDEX "movimientos_venta" ON "gestion"."movimientos" USING btree ("venta_id");--> statement-breakpoint
CREATE INDEX "traspasos_fecha" ON "gestion"."traspasos" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "ventas_fecha" ON "gestion"."ventas" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "ventas_vendedor_fecha" ON "gestion"."ventas" USING btree ("vendedor_id","fecha");--> statement-breakpoint
CREATE INDEX "ventas_ubicacion_fecha" ON "gestion"."ventas" USING btree ("ubicacion_id","fecha");