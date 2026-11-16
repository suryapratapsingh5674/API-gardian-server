// apps/server/tests/testSetup.js
//
// Shared helpers for test files that need a MongoDB connection.
//
// We use 'mongodb-memory-server' which starts a real MongoDB process
// in memory — no separate MongoDB installation needed for tests.
// Each test run gets its own clean database.
//
// USAGE in test files:
//
//   const { connectTestDB, disconnectTestDB, clearCollections } = require('./testSetup');
//
//   before(async () => { await connectTestDB(); });
//   after(async () => { await disconnectTestDB(); });
//   afterEach(async () => { await clearCollections(); });

'use strict';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

let mongod;

/**
 * Start an in-memory MongoDB server and connect Mongoose to it.
 * Call this once before all tests in a file (in a `before` hook).
 */
async function connectTestDB() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
}

/**
 * Disconnect Mongoose and stop the in-memory MongoDB server.
 * Call this once after all tests in a file (in an `after` hook).
 */
async function disconnectTestDB() {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

/**
 * Delete all documents from all collections.
 * Call this after each test (in an `afterEach` hook) to ensure
 * one test's data does not bleed into the next.
 */
async function clearCollections() {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
}

module.exports = { connectTestDB, disconnectTestDB, clearCollections };

