'use strict';
// La app de Express NO sabe dónde corre: se exporta sin llamar a listen().
// - src/server.js la levanta como proceso (EC2 / Elastic Beanstalk / contenedor)
// - src/lambda.js la envuelve como handler de Lambda (API Gateway)
const express = require('express');
const helmet = require('helmet');

const POKEAPI_URL = 'https://pokeapi.co/api/v2/pokemon';

// Pedido real a la PokeAPI (API pública y gratuita). Se inyecta en createApp para poder reemplazarlo en los tests (stub).
async function consultarPokeApi(nombre) {
  const res = await fetch(`${POKEAPI_URL}/${encodeURIComponent(nombre)}`, { signal: AbortSignal.timeout(5000) });
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error(`PokeAPI respondió ${res.status}`), { upstream: true });
  const d = await res.json();
  // Devolvemos solo lo que nuestra API necesita, no todo el JSON de la PokeAPI.
  return {
    id: d.id,
    nombre: d.name,
    tipos: d.types.map((t) => t.type.name),
    alturaDm: d.height,
    pesoHg: d.weight,
    imagen: d.sprites?.front_default ?? null,
  };
}

// OWASP: no confiar en lo que llega del cliente. Un nombre de Pokémon solo tiene letras, números y guiones.
const NOMBRE_VALIDO = /^[a-z0-9-]{1,50}$/;
const normalizar = (valor) => (typeof valor === 'string' ? valor.trim().toLowerCase() : '');

function createApp({ store = new Map(), fetchPokemon = consultarPokeApi } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // OWASP #2 (Security Misconfiguration): cabeceras de seguridad con Helmet.
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));

  // Log estructurado en JSON: CloudWatch Logs lo indexa y Logs Insights lo puede consultar por campo.
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      console.log(JSON.stringify({
        level: res.statusCode >= 500 ? 'error' : 'info',
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Math.round(ms * 10) / 10,
      }));
    });
    next();
  });

  // Health check: lo usan el Load Balancer / Beanstalk para saber si la instancia está sana.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', runtime: process.env.AWS_EXECUTION_ENV || 'proceso-node', env: process.env.APP_ENV || 'local' });
  });

  // Versionado en la URL (/api/v1): permite cambiar el contrato sin romper a los clientes actuales.
  const v1 = express.Router();

  // Busca un Pokémon en la PokeAPI. 400 si el nombre es inválido, 404 si no existe, 502 si la PokeAPI falla.
  async function buscar(nombreCrudo, res) {
    const nombre = normalizar(nombreCrudo);
    if (!NOMBRE_VALIDO.test(nombre)) {
      res.status(400).json({ error: 'Nombre inválido: solo letras, números y guiones (hasta 50 caracteres)' });
      return null;
    }
    let pokemon;
    try {
      pokemon = await fetchPokemon(nombre);
    } catch (err) {
      console.error(JSON.stringify({ level: 'error', message: err.message }));
      res.status(502).json({ error: 'No se pudo consultar la PokeAPI' });
      return null;
    }
    if (!pokemon) {
      res.status(404).json({ error: 'Pokémon no encontrado' });
      return null;
    }
    return pokemon;
  }

  // Consulta (proxy de la PokeAPI)
  v1.get('/pokemon/:nombre', async (req, res) => {
    const pokemon = await buscar(req.params.nombre, res);
    if (pokemon) res.json(pokemon);
  });

  // Favoritos: el CRUD propio de nuestra API (en memoria; en producción iría a RDS)
  v1.get('/favoritos', (_req, res) => res.json([...store.values()]));

  v1.post('/favoritos', async (req, res) => {
    const pokemon = await buscar(req.body?.nombre, res);
    if (!pokemon) return;
    if (store.has(pokemon.nombre)) return res.status(409).json({ error: 'Ya está en favoritos' });
    store.set(pokemon.nombre, pokemon);
    res.status(201).json(pokemon);
  });

  v1.delete('/favoritos/:nombre', (req, res) => {
    if (!store.delete(normalizar(req.params.nombre))) return res.status(404).json({ error: 'No está en favoritos' });
    res.status(204).end();
  });

  app.use('/api/v1', v1);

  app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // Manejo de errores (OWASP #2): nunca devolver el stack al cliente; el detalle queda solo en los logs.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(JSON.stringify({ level: 'error', message: err.message }));
    const status = err.status && err.status < 500 ? err.status : 500;
    res.status(status).json({ error: status === 500 ? 'Error interno' : 'Solicitud inválida' });
  });

  return app;
}

module.exports = { createApp, consultarPokeApi };
