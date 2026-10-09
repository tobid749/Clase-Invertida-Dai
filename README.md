# Demo: API Node.js para AWS (TP tema 2)

**Pokédex API** con Express: consulta la [PokeAPI](https://pokeapi.co) (API pública y gratuita) y permite guardar Pokémon favoritos. **El mismo código** corre de tres formas:

| Entrada | Dónde se usa | Archivo |
| --- | --- | --- |
| Proceso Node (escucha `PORT`) | EC2, Elastic Beanstalk | `src/server.js` |
| Contenedor Docker | cualquier host con Docker (EC2, ECS, local) | `Dockerfile` |
| Handler de Lambda (serverless-http) | API Gateway + Lambda | `src/lambda.js` |

`src/app.js` no llama a `listen()` y no sabe dónde corre.

## Requisitos

Node.js 22 o superior. Docker (opcional) y AWS CLI + SAM CLI (solo para desplegar).

## Instalación y variables de entorno

```bash
npm install
cp .env.example .env   # .env NO se sube al repo; .env.example sí (es la plantilla)
```

| Variable | Descripción | Default |
| --- | --- | --- |
| `PORT` | Puerto donde escucha el proceso | 8080 |
| `APP_ENV` | `desarrollo` / `produccion` | local |

## Endpoints (versión 1: `/api/v1`)

| Método | Ruta | Descripción | Respuestas |
| --- | --- | --- | --- |
| GET | `/health` | Estado del servicio | 200 |
| GET | `/api/v1/pokemon/:nombre` | Consulta un Pokémon en la PokeAPI (id, nombre, tipos, altura, peso, imagen) | 200, 400, 404, 502 |
| GET | `/api/v1/favoritos` | Lista los favoritos | 200 |
| POST | `/api/v1/favoritos` | Agrega a favoritos (`{"nombre":"pikachu"}`; se valida contra la PokeAPI) | 201, 400, 404, 409, 502 |
| DELETE | `/api/v1/favoritos/:nombre` | Quita de favoritos | 204, 404 |

Contrato completo en `openapi.yaml` (se puede abrir en Swagger Editor). Los favoritos se guardan en memoria; en producción irían a RDS. La API necesita salida a internet para llegar a la PokeAPI (Lambda y EC2 la tienen por defecto; una Lambda dentro de una VPC necesitaría un NAT Gateway).

## Probar en local

```bash
npm test                 # 18 tests (la PokeAPI se reemplaza por un stub: no necesitan internet)
npm run test:coverage    # cobertura
PORT=8080 npm start         # en una red con proxy que inspecciona TLS (error SELF_SIGNED_CERT_IN_CHAIN): npm run start:proxy
curl localhost:8080/health
curl localhost:8080/api/v1/pokemon/pikachu      # necesita internet
curl -X POST localhost:8080/api/v1/favoritos -H 'content-type: application/json' -d '{"nombre":"pikachu"}'
```

## Docker

```bash
docker build -t demo-api-aws .
docker run -p 8080:8080 demo-api-aws
```

## CI (GitHub Actions)

`.github/workflows/ci.yml` corre en cada push a `main` y en cada Pull Request: instala (`npm ci`), ejecuta los tests, audita dependencias (`npm audit`) y construye la imagen Docker. Si un paso falla, el pipeline se corta.

## Desplegar en Lambda (requiere AWS CLI y SAM CLI configurados)

```bash
sam build
sam deploy --guided --parameter-overrides AlertEmail=tu@correo.com
```

La salida `ApiUrl` es la URL pública. `template.yaml` crea la función (Node.js 22, arm64), la HTTP API, el log group con retención de 30 días, un tema SNS y dos alarmas de CloudWatch (errores y latencia p95). Para no dejar recursos facturando: `sam delete`.

## Desplegar en Elastic Beanstalk

El `Procfile` indica cómo arrancar (`web: npm start`). Crear el entorno con la plataforma Node.js 22 o 24 sobre Amazon Linux 2023 y configurar el health check en `/health`.

## Seguridad aplicada (OWASP Top 10)

- Security Misconfiguration: Helmet, sin `x-powered-by`, errores genéricos sin stack, secretos por variables de entorno (`.env` fuera del repo y de la imagen).
- Software Supply Chain Failures: `npm audit` en el pipeline.
- Validación de entradas: el nombre solo admite letras, números y guiones (así no se puede manipular la URL que se le pide a la PokeAPI); límite de 100 kb de body; timeout de 5 s hacia la PokeAPI.

## Estado de verificación

- `npm test`: 18 de 18 pasan; cobertura de líneas y funciones 100 %, ramas 92 %. La PokeAPI se simula con stubs y mocks de `fetch`.
- `npm audit`: 0 vulnerabilidades.
- **No verificado**: el entorno donde se armó no tenía salida a internet, así que la llamada **real** a pokeapi.co nunca se ejecutó (probala con `curl localhost:8080/api/v1/pokemon/pikachu`). Tampoco se construyó el `Dockerfile` (sin daemon de Docker), el workflow de GitHub Actions y `template.yaml` solo se validaron como YAML, y no se desplegó en AWS.
