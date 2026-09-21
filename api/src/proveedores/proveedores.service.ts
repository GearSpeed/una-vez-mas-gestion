import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DatosProveedor, DatosVehiculo, Proveedor, Vehiculo } from '@uvm/compartido';
import { asc, eq } from 'drizzle-orm';
import { type BaseDatos, DB } from '../db/conexion.js';
import { proveedores, vehiculos } from '../db/esquema.js';

const columnasProveedor = {
  id: proveedores.id,
  nombre: proveedores.nombre,
  contacto: proveedores.contacto,
  telefono: proveedores.telefono,
  distanciaKm: proveedores.distanciaKm,
  categoriasQueSurte: proveedores.categoriasQueSurte,
  notas: proveedores.notas,
  activo: proveedores.activo,
};

const columnasVehiculo = {
  id: vehiculos.id,
  nombre: vehiculos.nombre,
  rendimientoKmL: vehiculos.rendimientoKmL,
  notas: vehiculos.notas,
  activo: vehiculos.activo,
};

/** Proveedores (con su distancia de ida y vuelta) y vehículos (con su rendimiento). */
@Injectable()
export class ProveedoresService {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  proveedores(): Promise<Proveedor[]> {
    return this.db.select(columnasProveedor).from(proveedores).orderBy(asc(proveedores.nombre));
  }

  async crearProveedor(datos: DatosProveedor): Promise<Proveedor> {
    const [creado] = await this.db.insert(proveedores).values(datos).returning(columnasProveedor);
    if (!creado) throw new Error('No se creó el proveedor');
    return creado;
  }

  async actualizarProveedor(id: number, datos: DatosProveedor): Promise<Proveedor> {
    const [actualizado] = await this.db
      .update(proveedores)
      .set(datos)
      .where(eq(proveedores.id, id))
      .returning(columnasProveedor);
    if (!actualizado) throw new NotFoundException('El proveedor no existe.');
    return actualizado;
  }

  vehiculos(): Promise<Vehiculo[]> {
    return this.db.select(columnasVehiculo).from(vehiculos).orderBy(asc(vehiculos.nombre));
  }

  async crearVehiculo(datos: DatosVehiculo): Promise<Vehiculo> {
    const [creado] = await this.db.insert(vehiculos).values(datos).returning(columnasVehiculo);
    if (!creado) throw new Error('No se creó el vehículo');
    return creado;
  }

  async actualizarVehiculo(id: number, datos: DatosVehiculo): Promise<Vehiculo> {
    const [actualizado] = await this.db
      .update(vehiculos)
      .set(datos)
      .where(eq(vehiculos.id, id))
      .returning(columnasVehiculo);
    if (!actualizado) throw new NotFoundException('El vehículo no existe.');
    return actualizado;
  }
}
