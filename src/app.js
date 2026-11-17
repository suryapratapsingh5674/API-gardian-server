// apps/server/src/app.js
//
// This file creates and configures the Express application.
// We keep it separate from index.js so that tests can import the app
// without actually starting the server on a port.

'use strict';

const express = require('express');
const cors = require('cors');

const app = express();

// --- Middleware ---

// Parse incoming JSON request bodies.
// Without this, req.body would be undefined for POST requests.
app.use(express.json());

// Allow cross-origin requests. The mobile app and docs site run on
// different origins during development, so they need this.
app.use(cors());

// --- Routes ---

// Health check endpoint. Useful for deployment platforms and quick testing.
// Returns 200 OK with a simple JSON response.
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'api-guardian-server',
    version: '0.1.0',
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'api-guardian-server',
    timestamp: new Date().toISOString(),
  });
});

// Mount feature routers.
// Each router file handles a group of related endpoints.
// The path prefix here combines with the route paths defined inside each file.
//   e.g. /api/projects + POST / = POST /api/projects
//        /api/projects + GET /:id/status = GET /api/projects/:id/status
app.use('/api/projects', require('./routes/projects'));
app.use('/api/pair',     require('./routes/pairing'));
app.use('/api/devices',  require('./routes/devices'));
app.use('/api/errors',   require('./routes/errors'));

// --- 404 Handler ---
// If no route matched, send a clear error instead of Express's default HTML.
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// --- Global Error Handler ---
// Express recognises a 4-argument middleware as an error handler.
// Any route that calls next(error) will end up here.
// We log the error and return a generic 500 response.
// (The real error-handling logic for API Guardian itself lives in Phase 2+.)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

module.exports = app;

