'use strict';
// Punto de entrada para AWS Lambda detrás de API Gateway.
// Todo lo que está FUERA del handler se ejecuta una sola vez por entorno de ejecución (fase Init)
// y se reutiliza en las invocaciones "warm": acá conviene crear la app y las conexiones a la DB.
const serverless = require('serverless-http');
const { createApp } = require('./app');

const handler = serverless(createApp());

exports.handler = async (event, context) => {
  // No esperar a que el event loop quede vacío (útil si hay conexiones abiertas reutilizadas).
  context.callbackWaitsForEmptyEventLoop = false;
  return handler(event, context);
};
