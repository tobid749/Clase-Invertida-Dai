# Receta de la imagen (ver teoría de Docker: FROM, WORKDIR, COPY, RUN, EXPOSE, CMD).
FROM node:22-alpine
WORKDIR /app

# Capas ordenadas de menos a más cambiantes: si package*.json no cambia, npm ci usa la caché.
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV PORT=8080 APP_ENV=produccion
EXPOSE 8080
USER node
CMD ["node", "src/server.js"]
