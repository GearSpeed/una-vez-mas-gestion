# syntax=docker/dockerfile:1
#
# Una sola imagen: la API de NestJS que también sirve el front de Angular ya
# compilado. Mismo origen, sin CORS. Las migraciones corren con esta misma
# imagen (compose.prod.yml, servicio `migraciones`).

# ---- 1. Compilar compartido, api y web ----
FROM node:24.21-alpine AS construir
WORKDIR /app
COPY package.json package-lock.json ./
COPY compartido/package.json compartido/
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- 2. Solo lo que se necesita para correr la API ----
FROM node:24.21-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
COPY compartido/package.json compartido/
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --omit=dev --no-audit --no-fund --workspace=@uvm/api --workspace=@uvm/compartido

# ---- 3. Imagen final ----
FROM node:24.21-alpine
ENV NODE_ENV=production \
    PUERTO=3000 \
    WEB_DIST=/app/web
WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY --from=construir /app/package.json ./
COPY --from=construir /app/compartido/package.json compartido/
COPY --from=construir /app/compartido/dist compartido/dist
COPY --from=construir /app/api/package.json api/
COPY --from=construir /app/api/dist api/dist
COPY --from=construir /app/api/drizzle api/drizzle
COPY --from=construir /app/web/dist/web/browser web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/salud || exit 1
CMD ["node", "api/dist/main.js"]
