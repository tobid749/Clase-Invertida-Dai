'use strict';
// Estructura AAA de la teoría: Arrange (organizar) -> Act (actuar) -> Assert (verificar).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp, consultarPokeApi } = require('../src/app');
const { handler } = require('../src/lambda');

const POKE = '/api/v1/pokemon';
const FAV = '/api/v1/favoritos';

// STUB (teoría de la materia): reemplaza a la PokeAPI con respuestas predefinidas.
// Así los tests no dependen de internet y son rápidos y repetibles.
const PIKACHU = { id: 25, nombre: 'pikachu', tipos: ['electric'], alturaDm: 4, pesoHg: 60, imagen: null };
const BULBASAUR = { id: 1, nombre: 'bulbasaur', tipos: ['grass', 'poison'], alturaDm: 7, pesoHg: 69, imagen: null };
const stubPokeApi = async (nombre) => ({ pikachu: PIKACHU, bulbasaur: BULBASAUR })[nombre] ?? null;
const appConStub = () => createApp({ fetchPokemon: stubPokeApi });

// ---------- Tests de integración de la API (rutas + validación + errores) ----------

test('GET /health responde ok', async () => {
  const app = appConStub();
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('GET /pokemon/:nombre devuelve el Pokémon (también con mayúsculas)', async () => {
  const app = appConStub();
  const res = await request(app).get(`${POKE}/Pikachu`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, PIKACHU);
});

test('GET /pokemon/:nombre inexistente devuelve 404', async () => {
  const app = appConStub();
  const res = await request(app).get(`${POKE}/noexiste`);
  assert.equal(res.status, 404);
});

test('GET /pokemon/:nombre con caracteres raros devuelve 400 y no llega a la PokeAPI', async () => {
  let llamadas = 0;
  const app = createApp({ fetchPokemon: async () => { llamadas += 1; return PIKACHU; } });
  const res = await request(app).get(`${POKE}/${encodeURIComponent('../berry')}`);
  assert.equal(res.status, 400);
  assert.equal(llamadas, 0);
});

test('si la PokeAPI falla, devolvemos 502 sin detalles internos', async () => {
  const app = createApp({ fetchPokemon: async () => { throw new Error('boom interno'); } });
  const res = await request(app).get(`${POKE}/pikachu`);
  assert.equal(res.status, 502);
  assert.ok(!JSON.stringify(res.body).includes('boom'));
});

test('POST /favoritos guarda un Pokémon y GET /favoritos lo lista', async () => {
  const app = appConStub();
  const creado = await request(app).post(FAV).send({ nombre: 'pikachu' });
  const lista = await request(app).get(FAV);
  assert.equal(creado.status, 201);
  assert.deepEqual(lista.body, [PIKACHU]);
});

test('POST /favoritos repetido devuelve 409', async () => {
  const app = appConStub();
  await request(app).post(FAV).send({ nombre: 'pikachu' });
  const res = await request(app).post(FAV).send({ nombre: 'pikachu' });
  assert.equal(res.status, 409);
});

test('POST /favoritos con nombre que no es texto devuelve 400 (no confiar en el cliente)', async () => {
  const app = appConStub();
  const res = await request(app).post(FAV).send({ nombre: { $gt: '' } });
  assert.equal(res.status, 400);
});

test('POST /favoritos de un Pokémon que no existe devuelve 404', async () => {
  const app = appConStub();
  const res = await request(app).post(FAV).send({ nombre: 'noexiste' });
  assert.equal(res.status, 404);
});

test('DELETE /favoritos/:nombre borra y luego da 404', async () => {
  const app = appConStub();
  await request(app).post(FAV).send({ nombre: 'bulbasaur' });
  const primero = await request(app).delete(`${FAV}/bulbasaur`);
  const segundo = await request(app).delete(`${FAV}/bulbasaur`);
  assert.equal(primero.status, 204);
  assert.equal(segundo.status, 404);
});

test('la ruta sin versión ya no existe (el contrato es /api/v1)', async () => {
  const app = appConStub();
  const res = await request(app).get('/pokemon/pikachu');
  assert.equal(res.status, 404);
});

// ---------- Cliente de la PokeAPI (se reemplaza fetch: sin internet) ----------

test('consultarPokeApi se queda solo con los campos que necesitamos', async (t) => {
  const cuerpo = { id: 25, name: 'pikachu', height: 4, weight: 60, types: [{ type: { name: 'electric' } }], sprites: { front_default: 'http://img' }, otro: 'se descarta' };
  const f = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, status: 200, json: async () => cuerpo }));
  const r = await consultarPokeApi('pikachu');
  assert.deepEqual(r, { id: 25, nombre: 'pikachu', tipos: ['electric'], alturaDm: 4, pesoHg: 60, imagen: 'http://img' });
  assert.equal(f.mock.calls[0].arguments[0], 'https://pokeapi.co/api/v2/pokemon/pikachu');
});

test('consultarPokeApi devuelve null si la PokeAPI responde 404', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 404 }));
  assert.equal(await consultarPokeApi('noexiste'), null);
});

test('consultarPokeApi lanza error si la PokeAPI responde 500', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 500 }));
  await assert.rejects(() => consultarPokeApi('pikachu'), /PokeAPI respondió 500/);
});

// ---------- Seguridad (OWASP Top 10) ----------

test('OWASP #2: Helmet agrega cabeceras y no se expone x-powered-by', async () => {
  const app = appConStub();
  const res = await request(app).get('/health');
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('OWASP #2: un JSON roto devuelve 400 sin filtrar el stack', async () => {
  const app = appConStub();
  const res = await request(app).post(FAV).set('Content-Type', 'application/json').send('{roto');
  assert.equal(res.status, 400);
  assert.ok(!JSON.stringify(res.body).includes('node_modules'));
  assert.ok(!JSON.stringify(res.body).includes('SyntaxError'));
});

// ---------- El mismo código dentro de Lambda ----------

// Simula el evento que API Gateway (HTTP API, payload v2.0) le manda a Lambda.
function eventoHttp(method, path, body) {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: { host: 'abc123.execute-api.us-east-1.amazonaws.com', 'content-type': 'application/json' },
    requestContext: { http: { method, path, sourceIp: '127.0.0.1' } },
    body: body ? JSON.stringify(body) : undefined,
    isBase64Encoded: false,
  };
}

test('el handler de Lambda responde igual que el servidor (GET /health)', async () => {
  const res = await handler(eventoHttp('GET', '/health'), {});
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).status, 'ok');
});

test('el handler de Lambda valida igual que el servidor (nombre inválido -> 400, sin salir a internet)', async () => {
  const res = await handler(eventoHttp('POST', FAV, { nombre: '../x' }), {});
  assert.equal(res.statusCode, 400);
});
