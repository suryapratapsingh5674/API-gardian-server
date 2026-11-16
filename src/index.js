// apps/server/src/index.js
// 
// This is the entry point for the API Guardian central backend.
// It loads environment variables, connects to MongoDB, then starts
// the Express server. We do those steps in order because the server
// should not accept requests before the database is ready.

'use strict';

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../.env') }); // Load apps/server/.env

const app = require('./app');
const { connectDatabase } = require('./db');

const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    // Step 1: Connect to the database before accepting any requests.
    await connectDatabase();

    // Step 2: Start listening for HTTP requests on all network interfaces (0.0.0.0).
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[API Guardian Server] Running on http://0.0.0.0:${PORT}`);
      console.log(`[API Guardian Server] Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    // If we cannot connect to the database, there is no point running.
    console.error('[API Guardian Server] Failed to start:', error.message);
    process.exit(1);
  }
}

startServer();

