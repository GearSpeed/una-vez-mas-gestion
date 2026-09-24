# Seguridad

Este documento es el resultado de la revisión que se hizo antes de publicar la aplicación
en internet, y la guía para mantenerla protegida. Tres frentes: el código de la API, la
infraestructura del servidor y los datos.

## Cómo está protegido, capa por capa

| Capa             | Qué la protege                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Quién entra      | Cloudflare Access delante de todo; la app además valida el JWT que firma Access                         |
| Qué puede hacer  | Permisos por rol, con un guard que niega toda ruta que no declare cuál exige                            |
| Qué datos recibe | La API filtra costos y márgenes, y un vendedor solo ve sus ventas                                       |
| La red           | La aplicación no abre ningún puerto: `cloudflared` sale hacia Cloudflare, nadie entra                   |
| La base          | Tres roles separados; la API no borra y no puede reescribir el kardex                                   |
| El sitio público | Una ruta de solo lectura, cacheada; el sitio nunca toca la base                                         |
| Las fotos        | Bucket privado de R2, servido por `img.unavezmasmx.com`; la app reescribe cada imagen y le quita el GPS |
| Los respaldos    | Cifrados en la nube, con prueba de restauración                                                         |

## Decisiones que sostienen todo lo demás

- **El sitio no se conecta a la base.** Lee `GET /api/publico/catalogo`
  (ver [contrato-sitio.md](contrato-sitio.md)). Se descartó abrir una ruta TCP del túnel
  hacia Postgres para Hyperdrive: eso dejaba el motor de base de datos alcanzable desde la
  red de Cloudflare, protegido solo por una credencial estática, y un error de
  configuración lo habría dejado abierto sin que nada se rompiera a la vista.
- **Los puertos abiertos son los mínimos y están controlados.** El servidor es compartido
  (EasyPanel, n8n y un servidor de correo), así que «cero puertos» no aplica: quedan
  abiertos 22, 80, 443 y los del correo, y nada más. El panel de EasyPanel, que manda sobre
  Docker, se cerró a internet y solo se alcanza por Cloudflare o por un túnel SSH.
- **SSH solo con llave y nunca como root**, con `fail2ban` vigilando y el firewall negando
  por omisión. La vía de emergencia es la consola VNC del panel de Contabo.
- **Al sitio no se le publica la existencia exacta**, solo `disponible`, `ultimas_piezas` o
  `agotado`: con el número exacto, cualquiera que consulte dos veces al día estima las
  ventas del negocio y cuánta mercancía traen los vendedores.
- **Las fotos se sirven por un dominio propio** (`img.unavezmasmx.com`) desde un bucket de
  Cloudflare R2 que por el lado S3 sigue privado: por el dominio no se puede listar ni
  escribir, la URL no delata dónde están guardadas y las sirve la caché de Cloudflare. El
  token que usa la app está limitado a ese bucket.
- **Nada de lo sensible vive en el repositorio.** El `.env` nunca se versionó (se
  verificó en todo el historial), la semilla no lleva costos ni proveedores reales, y los
  respaldos están excluidos.

## Qué se corrigió en esta revisión

### En la API

| Qué                       | Por qué importaba                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| Límite de peticiones      | Sin él, un solo usuario agotaba las conexiones de Postgres y tumbaba la app para todos    |
| Subida de imágenes        | Aceptaba 60 megapíxeles y decodificaba dos veces: unas pocas subidas mataban el proceso   |
| Modo desarrollo           | Solo se bloqueaba con `NODE_ENV=production`, que tiene valor por omisión: fallaba abierto |
| JWT de Access             | Se aceptaba sin restringir el algoritmo y aunque no trajera vencimiento                   |
| Llaves de Access por http | Quien estuviera en el camino podía servir sus llaves y firmar tokens con cualquier correo |
| Defensa contra CSRF       | Dejaba pasar peticiones sin `Sec-Fetch-Site`; ahora los POST deben venir como JSON        |
| Cancelar una venta        | No comprobaba que la venta fuera del vendedor, a diferencia del resto de operaciones      |
| Caché del navegador       | Ventas, costos y correos quedaban guardados en equipos compartidos                        |
| Paginación                | Sin tope: una página enorme hacía que Postgres recorriera el índice completo              |
| Correos en el log         | Cada línea del log guardaba el correo del usuario                                         |
| `/api/salud`              | Consultaba la base en cada llamada y decía si estaba caída                                |
| Fotos reemplazadas        | Se quedaban públicas para siempre; ahora se borran del bucket                             |

### En la base de datos

- Los permisos por omisión ya no reparten escritura: antes, **cualquier vista nueva sobre
  `movimientos` le habría devuelto a la API el UPDATE que se le revoca**, y el kardex
  dejaría de ser inmutable. Cada migración concede la escritura tabla por tabla.
- Las vistas internas corren con los permisos de quien consulta (`security_invoker`), y la
  del sitio con barrera de seguridad.
- Los roles tienen límites de consulta, de transacción abierta y de conexiones; el del
  sitio, además, solo lectura por omisión.
- La bitácora deja de duplicar correos, y hay un guion para purgar lo más viejo de 24
  meses (`ops/purgar-bitacora.sh`).

### En la infraestructura

- Producción ya no compila en el servidor ni despliega `latest`: se despliega una imagen
  concreta por SHA, que se puede revertir.
- Redes separadas: `cloudflared`, que es lo único expuesto, no alcanza la base.
- Contenedores sin privilegios (`no-new-privileges`, sin capacidades, sistema de archivos
  de solo lectura donde se puede), con límites de memoria y de logs.
- Los respaldos se escriben con permisos cerrados, se validan antes de darse por buenos y
  se prueban restaurando en un contenedor aparte.

## Lo que queda asumido (y por qué)

- **El token del bucket puede escribir sus objetos.** Está limitado a ese bucket, así que
  una filtración no alcanza nada más de la cuenta; aun así, quien lo tenga podría sustituir
  fotos del catálogo. Se mitiga rotándolo (docs/despliegue.md) y revisando el bucket.
- **El rol del sitio puede ver los nombres de tablas y columnas** por el catálogo del
  sistema de Postgres; los datos no. Aislarlo del todo exigiría una base aparte.
- **`style-src 'unsafe-inline'`** en la política de contenido: lo exige Angular Material
  hoy.
- **Almacén ve los costos de proveedor** de las compras que captura, aunque no tenga el
  permiso `costos.ver`. Es a propósito: es quien los escribe.

## Lo que hay que hacer en el servidor

Estos pasos no viven en el repositorio; están detallados en
[despliegue.md](despliegue.md), sección «Endurecer el servidor».

1. Usuario sin privilegios, SSH solo con llave y sin root. **Hecho.**
2. Firewall que deniega todo lo entrante, más la regla de `DOCKER-USER` que cierra el panel
   de EasyPanel. **Hecho.**
3. Actualizaciones de seguridad automáticas, `fail2ban` y memoria de intercambio. **Hecho.**
4. El panel de EasyPanel detrás de Cloudflare Access, por el mismo túnel de la aplicación.
5. `.env` en modo 600.
6. Dos políticas de Access: sesión corta con doble factor para administradores, sesión
   larga para vendedores.
7. Conectar `img.unavezmasmx.com` al bucket de R2 y correr `npm run probar-imagenes`:
   confirma que las fotos se sirven y que sin llaves nadie lista ni escribe.
8. Bucket de respaldos privado, con retención de 30 días y su propio token: es lo que
   salva de un ransomware. Y la contraseña del cifrado, guardada fuera del servidor.
9. Restaurar un respaldo antes de dar el sistema por bueno.

## Mantenimiento

| Cada cuándo          | Qué                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Mensual              | Revisar el registro de Access, confirmar quién tiene acceso, probar el respaldo                                        |
| Trimestral           | Rotar `SITIO_LECTURA_PASSWORD`; desplegar una imagen al día                                                            |
| Semestral            | Rotar las contraseñas de Postgres y las llaves S3; purgar la bitácora                                                  |
| Cuando alguien se va | Quitarlo de Access **y revocar su sesión**, darlo de baja en la app, y rotar lo del `.env` si tenía acceso al servidor |
| Cuando GitHub avise  | Actualizar dependencias; `npm audit` corre en cada integración                                                         |

## Si algo pasa

1. **Cortar el acceso**: apagar el túnel (`docker compose stop cloudflared`) deja la app
   inalcanzable en segundos, sin perder datos.
2. **Rotar todo** lo del `.env`, empezando por el token del túnel: con ese token alguien
   puede recibir tráfico del túnel desde otra máquina.
3. **Revisar la bitácora** (`gestion.bitacora`) y el registro de Access para saber qué se
   tocó y quién entró.
4. **Restaurar** el último respaldo bueno con `ops/probar-respaldo.sh` como ensayo antes
   de restaurar de verdad.
