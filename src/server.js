'use strict';
// Punto de entrada para EC2 / Elastic Beanstalk / contenedor: un proceso Node que escucha un puerto.
const { createApp } = require('./app');

// Beanstalk (y casi cualquier PaaS) inyecta el puerto por variable de entorno.
const port = Number(process.env.PORT) || 8080;
const app = createApp();

const server = app.listen(port, () => {
  console.log(JSON.stringify({ level: 'info', message: `API escuchando en el puerto ${port}` }));
});

// Apagado ordenado: al hacer un deploy el orquestador manda SIGTERM.
process.on('SIGTERM', () => {
  console.log(JSON.stringify({ level: 'info', message: 'SIGTERM recibido, cerrando' }));
  server.close(() => process.exit(0));
});
