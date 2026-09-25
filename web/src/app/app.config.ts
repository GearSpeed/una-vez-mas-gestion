import { registerLocaleData } from '@angular/common';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import localeEsMx from '@angular/common/locales/es-MX';
import {
  type ApplicationConfig,
  DEFAULT_CURRENCY_CODE,
  inject,
  LOCALE_ID,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { DateAdapter, MAT_DATE_FORMATS, MAT_DATE_LOCALE } from '@angular/material/core';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatIconRegistry } from '@angular/material/icon';
import { provideRouter, TitleStrategy, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { correoDesarrolloInterceptor } from './core/interceptores';
import { SesionService } from './core/sesion';
import { TituloPagina } from './core/titulo';
import { AdaptadorFechaTexto, FORMATOS_FECHA } from './ui/adaptador-fecha';

registerLocaleData(localeEsMx);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([correoDesarrolloInterceptor])),
    { provide: TitleStrategy, useClass: TituloPagina },
    { provide: LOCALE_ID, useValue: 'es-MX' },
    { provide: DEFAULT_CURRENCY_CODE, useValue: 'MXN' },
    // El calendario trabaja con las mismas fechas de texto que la API: ver
    // `ui/adaptador-fecha.ts`.
    { provide: MAT_DATE_LOCALE, useValue: 'es-MX' },
    { provide: DateAdapter, useClass: AdaptadorFechaTexto },
    { provide: MAT_DATE_FORMATS, useValue: FORMATOS_FECHA },
    {
      provide: MAT_FORM_FIELD_DEFAULT_OPTIONS,
      useValue: { appearance: 'outline', subscriptSizing: 'dynamic' },
    },
    // Antes de la primera pantalla: la sesión (de ella salen menú y permisos).
    provideAppInitializer(() => {
      inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined');
      return inject(SesionService).cargar();
    }),
  ],
};
