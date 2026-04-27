'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const memoryRouter = require('./routes/memory');
const chatRouter = require('./routes/chat');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', memoryRouter);
app.use('/api', chatRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Express 5's app.listen(port, cb) registers `cb` as a one-shot *error* listener too.
// On EADDRINUSE (or any listen error), that still invokes the "success" callback once,
// prints a misleading "listening" line, then the process exits with code 0.
// Avoid passing a callback to app.listen; use 'listening' / 'error' on the server instead.
const server = app.listen(PORT);

server.on('listening', () => {
  console.log(`Jarvis listening on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Stop the other process (or set PORT) and try again.`
    );
  } else {
    console.error('Server failed to start:', err);
  }
  process.exit(1);
});
