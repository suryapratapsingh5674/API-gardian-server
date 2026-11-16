// apps/server/tests/e2e-phase5-verification.test.js
//
// Complete Phase 5 verification test:
//   "Test a real error in the demo backend and verify that only
//    the devices paired with that project receive its alert."
//
// Workflow verified:
//   1. Register Project A and Project B.
//   2. Pair Device A with Project A.
//   3. Pair Device B with Project B.
//   4. SDK sends error event from Project A (simulating /crash).
//   5. Push notification is dispatched to Device A's push token ONLY.
//   6. Device B receives 0 notifications.
//   7. Device A queries error history via authenticated mobile endpoint and views details.
//   8. Device B queries error history and sees 0 errors (perfect multi-project isolation).

'use strict';

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const supertest = require('supertest');

const app = require('../src/app');
const { connectTestDB, disconnectTestDB, clearCollections } = require('./testSetup');

let mockExpoServer;
let mockExpoUrl;
let receivedPushBatches = [];

before(async () => {
  await connectTestDB();

  // Mock Expo push server
  mockExpoServer = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(raw);
        receivedPushBatches.push(parsed);
      } catch {
        receivedPushBatches.push(raw);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ status: 'ok', id: 'sample-ticket' }] }));
    });
  });

  await new Promise((resolve) => {
    mockExpoServer.listen(0, '127.0.0.1', () => {
      mockExpoUrl = `http://127.0.0.1:${mockExpoServer.address().port}`;
      process.env.EXPO_PUSH_URL = mockExpoUrl;
      resolve();
    });
  });
});

after(async () => {
  if (mockExpoServer) {
    await new Promise((resolve) => mockExpoServer.close(resolve));
  }
  delete process.env.EXPO_PUSH_URL;
  await disconnectTestDB();
});

afterEach(async () => {
  await clearCollections();
  receivedPushBatches = [];
});

describe('Phase 5 End-to-End: Error Alerting & Mobile History', () => {
  test('error alert delivered strictly to paired device and visible in mobile history', async () => {
    // ── 1. Create Project A (e.g. Developer App A) ──────────────────────────
    const regResA = await supertest(app)
      .post('/api/projects')
      .send({ projectName: 'Demo Express App A' });
    assert.equal(regResA.status, 201);
    const projA = { id: regResA.body.projectId, apiKey: regResA.body.apiKey };

    // ── 2. Create Project B (e.g. Developer App B) ──────────────────────────
    const regResB = await supertest(app)
      .post('/api/projects')
      .send({ projectName: 'Different App B' });
    assert.equal(regResB.status, 201);
    const projB = { id: regResB.body.projectId, apiKey: regResB.body.apiKey };

    // ── 3. Pair Device A with Project A ─────────────────────────────────────
    const sessResA = await supertest(app)
      .post(`/api/projects/${projA.id}/sessions`)
      .set('Authorization', `Bearer ${projA.apiKey}`);
    const pairResA = await supertest(app)
      .post('/api/pair')
      .send({
        token: sessResA.body.token,
        expoPushToken: 'ExponentPushToken[device-A-token]',
        deviceName: 'Pixel 8 (Dev A)',
        platform: 'android',
      });
    assert.equal(pairResA.status, 201);
    const devA = { id: pairResA.body.deviceId, credential: pairResA.body.deviceCredential };

    // ── 4. Pair Device B with Project B ─────────────────────────────────────
    const sessResB = await supertest(app)
      .post(`/api/projects/${projB.id}/sessions`)
      .set('Authorization', `Bearer ${projB.apiKey}`);
    const pairResB = await supertest(app)
      .post('/api/pair')
      .send({
        token: sessResB.body.token,
        expoPushToken: 'ExponentPushToken[device-B-token]',
        deviceName: 'Galaxy S24 (Dev B)',
        platform: 'android',
      });
    assert.equal(pairResB.status, 201);
    const devB = { id: pairResB.body.deviceId, credential: pairResB.body.deviceCredential };

    // ── 5. Simulate real error reported by Demo App A (GET /crash) ─────────
    const crashReport = await supertest(app)
      .post('/api/errors')
      .set('Authorization', `Bearer ${projA.apiKey}`)
      .set('X-Project-Id', projA.id)
      .send({
        eventType: 'middleware',
        message: 'Database connection failed during checkout',
        stack: 'Error: Connection lost\n    at checkout.js:34:12\n    at node_modules/mysql/index.js:50:2',
        statusCode: 500,
        route: '/api/checkout',
        correlationId: 'req-prod-001',
      });

    assert.equal(crashReport.status, 201);
    const reportedEventId = crashReport.body.eventId;
    assert.ok(reportedEventId);

    // Give background push delivery a short moment
    for (let i = 0; i < 30 && receivedPushBatches.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // ── 6. Verify Push Notification Delivery Isolation ─────────────────────
    // There should be exactly 1 push notification batch sent
    assert.equal(receivedPushBatches.length, 1);
    const messages = receivedPushBatches[0];
    assert.equal(messages.length, 1);

    // Must be sent to Device A's token
    assert.equal(messages[0].to, 'ExponentPushToken[device-A-token]');
    assert.match(messages[0].title, /Demo Express App A/);
    assert.match(messages[0].title, /500/);
    assert.match(messages[0].body, /Database connection failed during checkout/);
    assert.equal(messages[0].data.eventId, reportedEventId.toString());

    // Verify Device B NEVER received a push notification
    const anyMessageToB = receivedPushBatches.some((batch) =>
      batch.some((msg) => msg.to === 'ExponentPushToken[device-B-token]')
    );
    assert.equal(anyMessageToB, false, 'Device B must NEVER receive alerts for Project A');

    // ── 7. Device A checks error history in companion app ───────────────────
    const historyResA = await supertest(app)
      .get('/api/errors')
      .set('Authorization', `Bearer ${devA.credential}`)
      .set('X-Device-Id', devA.id);

    assert.equal(historyResA.status, 200);
    assert.equal(historyResA.body.events.length, 1);
    assert.equal(historyResA.body.events[0]._id, reportedEventId);
    assert.equal(historyResA.body.events[0].route, '/api/checkout');

    // ── 8. Device A checks full error details with sanitized stack ──────────
    const detailResA = await supertest(app)
      .get(`/api/errors/${reportedEventId}`)
      .set('Authorization', `Bearer ${devA.credential}`)
      .set('X-Device-Id', devA.id);

    assert.equal(detailResA.status, 200);
    assert.equal(detailResA.body.event.message, 'Database connection failed during checkout');
    assert.ok(!detailResA.body.event.safeStack.includes('node_modules'), 'Stack trace should be sanitized');

    // ── 9. Device B checks error history in companion app ───────────────────
    const historyResB = await supertest(app)
      .get('/api/errors')
      .set('Authorization', `Bearer ${devB.credential}`)
      .set('X-Device-Id', devB.id);

    assert.equal(historyResB.status, 200);
    assert.equal(historyResB.body.events.length, 0, 'Project B must have 0 errors');
  });
});
