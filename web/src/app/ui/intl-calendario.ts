import { Injectable, type Provider } from '@angular/core';
import { MatDatepickerIntl } from '@angular/material/datepicker';

/** Lo que dicen los lectores de pantalla del calendario, en español. */
@Injectable()
export class IntlCalendario extends MatDatepickerIntl {
  override calendarLabel = 'Calendario';
  override openCalendarLabel = 'Abrir el calendario';
  override closeCalendarLabel = 'Cerrar el calendario';
  override prevMonthLabel = 'Mes anterior';
  override nextMonthLabel = 'Mes siguiente';
  override prevYearLabel = 'Año anterior';
  override nextYearLabel = 'Año siguiente';
  override prevMultiYearLabel = 'Veinticuatro años anteriores';
  override nextMultiYearLabel = 'Veinticuatro años siguientes';
  override switchToMonthViewLabel = 'Elegir la fecha';
  override switchToMultiYearViewLabel = 'Elegir el mes y el año';
  override startDateLabel = 'Fecha inicial';
  override endDateLabel = 'Fecha final';
}

/**
 * Los textos del calendario, para las pantallas que lo abren.
 *
 * Va aquí y no en `app.config.ts` a propósito: importar el calendario desde la
 * configuración se lleva 157 kB al paquete inicial, el que descarga todo el mundo
 * al entrar, incluida una vendedora con datos en el celular que a lo mejor nunca
 * abre una pantalla con fechas.
 */
export const CALENDARIO_EN_ESPANOL: Provider[] = [
  { provide: MatDatepickerIntl, useClass: IntlCalendario },
];
