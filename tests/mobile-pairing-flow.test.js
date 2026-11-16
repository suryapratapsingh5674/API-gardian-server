// apps/server/tests/mobile-pairing-flow.test.js
//
// End-to-end integration test verifying the exact pairing exchange
// between the SDK terminal QR payload, the mobile companion app,
// and the central backend.

'use strict';

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');

const app = require('../src/app');
const Project = require('../src/models/Project');
const Device = require('../src/models/Device');
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

describe('Mobile App Pairing Flow (Phase 4 Verification)', () => {
  test('full flow: SDK creates session -> QR payload scanned -> mobile pairs -> project marked active', async () => {
    // 1. SDK registers project
    const regRes = await supertest(app)
      .post('/api/projects')
      .send({ projectName: 'E2E Express Service' });
    assert.equal(regRes.status, 201);
    const { projectId, apiKey, projectName } = regRes.body;

    // 2. SDK requests pairing session to show in terminal QR code
    const sessionRes = await supertest(app)
      .post(`/api/projects/${projectId}/sessions`)
      .set('Authorization', `Bearer ${apiKey}`);
    assert.equal(sessionRes.status, 201);
    const { token, expiresAt } = sessionRes.body;

    // 3. SDK encodes terminal QR code payload
    const qrString = JSON.stringify({
      serverUrl: 'http://localhost:3001',
      projectId,
      projectName,
      token,
    });

    // 4. Mobile app scans QR and parses JSON (as ScanScreen.js does)
    const scannedPayload = JSON.parse(qrString);
    assert.equal(scannedPayload.projectId, projectId);
    assert.equal(scannedPayload.projectName, 'E2E Express Service');
    assert.equal(scannedPayload.token, token);

    // 5. Mobile app requests push permissions and submits confirmation (ConfirmScreen.js / pairing.js)
    const expoPushToken = 'ExponentPushToken[mobile-device-sample-token-123]';
    const pairRes = await supertest(app)
      .post('/api/pair')
      .send({
        token: scannedPayload.token,
        expoPushToken,
        deviceName: 'Pixel 8 Test Device',
        platform: 'android',
      });

    assert.equal(pairRes.status, 201);
    assert.ok(pairRes.body.deviceId, 'Should return deviceId');
    assert.ok(pairRes.body.deviceCredential, 'Should return deviceCredential');
    assert.equal(pairRes.body.projectId.toString(), projectId.toString());
    assert.equal(pairRes.body.projectName, 'E2E Express Service');

    // 6. Verify database records: Device is registered and linked to project
    const deviceInDb = await Device.findById(pairRes.body.deviceId);
    assert.ok(deviceInDb);
    assert.equal(deviceInDb.projectId.toString(), projectId.toString());
    assert.equal(deviceInDb.expoPushToken, expoPushToken);
    assert.equal(deviceInDb.platform, 'android');
    assert.equal(deviceInDb.isActive, true);

    // 7. Verify project hasActiveDevice flag in DB
    const projectInDb = await Project.findById(projectId);
    assert.equal(projectInDb.hasActiveDevice, true);

    // 8. SDK checks status on next startup (or poller tick) -> sees active device
    const statusRes = await supertest(app)
      .get(`/api/projects/${projectId}/status`)
      .set('Authorization', `Bearer ${apiKey}`);

    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.body.hasActiveDevice, true);
    assert.equal(statusRes.body.activeDeviceCount, 1);

    // 9. Verify token cannot be reused by another scan
    const reuseRes = await supertest(app)
      .post('/api/pair')
      .send({
        token: scannedPayload.token,
        expoPushToken: 'ExponentPushToken[second-device-attempt]',
        deviceName: 'Attacker or Second Scan',
        platform: 'android',
      });
    assert.equal(reuseRes.status, 400);
  });
});

