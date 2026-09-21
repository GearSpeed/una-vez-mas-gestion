import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { type RouterStateSnapshot, TitleStrategy } from '@angular/router';

/** "Nueva venta · Una vez más": cada pantalla con su título, para el historial y los lectores. */
@Injectable({ providedIn: 'root' })
export class TituloPagina extends TitleStrategy {
  private readonly titulo = inject(Title);

  override updateTitle(estado: RouterStateSnapshot): void {
    const propio = this.buildTitle(estado);
    this.titulo.setTitle(propio ? `${propio} · Una vez más` : 'Una vez más · Gestión');
  }
}
