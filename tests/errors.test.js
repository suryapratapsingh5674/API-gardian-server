// apps/server/tests/errors.test.js
//
// Integration tests for:
//   POST /api/errors  (report an error event — authenticated)
//   GET  /api/errors  (list error events — authenticated)

'use strict';

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');

const app = require('../src/app');
const { connectTestDB, disconnectTestDB, clearCollections } = require('./testSetup');

before(async () => {
  await connectTestDB();
});

after(async () => {
  await disconnectTestDB();
});

afterEach(async () => {
  await clearCollections();
});

async function createProject(name = 'Error Test Project') {
  const res = await supertest(app)
    .post('/api/projects')
    .send({ projectName: name });
  return { projectId: res.body.projectId, apiKey: res.body.apiKey };
}

describe('POST /api/errors', () => {
  test('stores a middleware error event and returns eventId', async () => {
    const { projectId, apiKey } = await createProject();

    const res = await supertest(app)
      .post('/api/errors')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Project-Id', projectId)
      .send({
        eventType: 'middleware',
        message: 'Cannot read property of undefined',
        stack: 'Error: Cannot read property of undefined\n    at /app/routes/users.js:42:15',
        statusCode: 500,
        route: '/api/users/:id',
        correlationId: 'req-abc-123',
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.eventId, 'should return an eventId');
  });

  test('stores a manual error event', async () => {
    const { projectId, apiKey } = await createProject();

    const res = await supertest(app)
      .post('/api/errors')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Project-Id', projectId)
      .send({
        eventType: 'manual',
        message: 'Background job failed',
      });

    assert.equal(res.status, 201);
    assert.ok(res.body.eventId);
  });

  test('returns 204 (no content) for 4xx errors reported via middleware', async () => {
    // 4xx errors (like 404 or 422) are expected user errors.
    // We do not store or notify for them by default.
    const { projectId, apiKey } = await createProject();

    const res = await supertest(app)
      .post('/api/errors')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Project-Id', projectId)
      .send({
        eventType: 'middleware',
        message: 'User not found',
        statusCode: 404,
        route: '/api/users/:id',
      });

    assert.equal(res.status, 204);
  });

  test('returns 400 if eventType is invalid', async () => {
    const { projectId, apiKey } = await createProject();

    const res = await supertest(app)
      .post('/api/errors')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Project-Id', projectId)
      .send({ eventType: 'invalid', message: 'test' });

    assert.equal(res.status, 400);
  });

  test('returns 401 without authentication', async () => {
    const res = await supertest(app)
      .post('/api/errors')
      .send({ eventType: 'middleware', message: 'test' });

    assert.equal(res.status, 401);
  });
});

describe('GET /api/errors', () => {
  test('returns stored error events for the authenticated project', async () => {
    const { projectId, apiKey } = await createProject();

    // Store two error events
    await supertest(app)
      .post('/api/errors')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Project-Id', projectId)
      .send({ eventType: 'middleware', message: 'First error', statusCode: 500 });

    await supertest(app)
      .post('/api/errors')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Project-Id', projectId)
      .send({ eventType: 'manual', message: 'Second error' });

    const res = await supertest(app)
      .get('/api/errors')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-Project-Id', projectId);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.events));
    assert.equal(res.body.events.length, 2);
  });

  test('does not return events from a different project', async () => {
    const projectA = await createProject('Project A');
    const projectB = await createProject('Project B');

    // Add an error to project A
    await supertest(app)
      .post('/api/errors')
      .set('Authorization', `Bearer ${projectA.apiKey}`)
      .set('X-Project-Id', projectA.projectId)
      .send({ eventType: 'middleware', message: 'Project A error', statusCode: 500 });

    // Project B should see 0 events
    const res = await supertest(app)
      .get('/api/errors')
      .set('Authorization', `Bearer ${projectB.apiKey}`)
      .set('X-Project-Id', projectB.projectId);

    assert.equal(res.status, 200);
    assert.equal(res.body.events.length, 0);
  });
});
