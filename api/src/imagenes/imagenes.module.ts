import { Global, Module } from '@nestjs/common';
import { AlmacenImagenes } from './almacen-imagenes.js';

@Global()
@Module({
  providers: [AlmacenImagenes],
  exports: [AlmacenImagenes],
})
export class ImagenesModule {}
