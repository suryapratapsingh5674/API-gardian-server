// apps/server/src/db.js
//
// Handles the MongoDB connection using Mongoose.
// We export a single connectDatabase() function so that index.js
// can await it before starting the Express server.

'use strict';

const mongoose = require('mongoose');

async function connectDatabase() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Copy .env.example to .env and add your connection string.'
    );
  }

  // Mongoose emits useful events during the connection lifecycle.
  mongoose.connection.on('connected', () => {
    console.log('[Database] Connected to MongoDB');
  });

  mongoose.connection.on('error', (err) => {
    // Log connection errors without crashing. Mongoose will try to reconnect.
    console.error('[Database] Connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[Database] Disconnected from MongoDB');
  });

  await mongoose.connect(uri);
}

module.exports = { connectDatabase };

