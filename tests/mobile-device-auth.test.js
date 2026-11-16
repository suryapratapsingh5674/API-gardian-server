// apps/server/tests/mobile-device-auth.test.js
//
// Tests for mobile device authentication:
//   - GET /api/errors authenticated via deviceCredential
//   - GET /api/errors/:eventId authenticated via deviceCredential
//   - DELETE /api/devices/:id (device unpairing)
//   - Rejection of inactive or invalid device credentials

'use strict';

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const supertest = require('supertest');

const app = require('../src/app');
const Project = require('../src/models/Project');
const Device = require('../src/models/Device');
const ErrorEvent = require('../src/models/ErrorEvent');
const { generateToken, hashToken } = require('../src/utils/crypto');
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

async function setupTestProjectAndDevice() {
  const project = await Project.create({
    projectName: 'Mobile Auth Project',
    projectKeyHash: hashToken('project-api-key-123'),
    hasActiveDevice: true,
  });

  const rawDeviceCredential = generateToken(32);
  const deviceCredentialHash = hashToken(rawDeviceCredential);

  const device = await Device.create({
    projectId: project._id,
    expoPushToken: 'ExponentPushToken[mobile-auth-token]',
    deviceName: 'Test Phone',
    platform: 'android',
    deviceCredentialHash,
    isActive: true,
  });

  return {
    project,
    device,
    deviceId: device._id.toString(),
    deviceCredential: rawDeviceCredential,
  };
}

describe('Mobile Device Error Endpoints', () => {
  test('paired device can fetch error history using device credentials', async () => {
    const { project, deviceId, deviceCredential } = await setupTestProjectAndDevice();

    // Create two test error events
    await ErrorEvent.create({
      projectId: project._id,
      eventType: 'middleware',
      message: 'Uncaught TypeError in route',
      statusCode: 500,
      route: '/api/checkout',
    });

    await ErrorEvent.create({
      projectId: project._id,
      eventType: 'manual',
      message: 'Payment gateway timeout',
      statusCode: 502,
    });

    const res = await supertest(app)
      .get('/api/errors')
      .set('Authorization', `Bearer ${deviceCredential}`)
      .set('X-Device-Id', deviceId);

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.events));
    assert.equal(res.body.events.length, 2);
    assert.equal(res.body.totalCount, 2);
  });

  test('paired device can fetch specific error details using device credentials', async () => {
    const { project, deviceId, deviceCredential } = await setupTestProjectAndDevice();

    const errorEvent = await ErrorEvent.create({
      projectId: project._id,
      eventType: 'middleware',
      message: 'Out of memory error',
      statusCode: 500,
      route: '/api/process',
      safeStack: 'Error: Out of memory\n    at worker.js:12:4',
    });

    const res = await supertest(app)
      .get(`/api/errors/${errorEvent._id}`)
      .set('Authorization', `Bearer ${deviceCredential}`)
      .set('X-Device-Id', deviceId);

    assert.equal(res.status, 200);
    assert.equal(res.body.event.message, 'Out of memory error');
    assert.equal(res.body.event.safeStack, 'Error: Out of memory\n    at worker.js:12:4');
  });

  test('rejects mobile device with wrong credential', async () => {
    const { deviceId } = await setupTestProjectAndDevice();

    const res = await supertest(app)
      .get('/api/errors')
      .set('Authorization', 'Bearer wrong-credential-string')
      .set('X-Device-Id', deviceId);

    assert.equal(res.status, 401);
  });

  test('DELETE /api/devices/:id unpairs the device and updates project status', async () => {
    const { project, deviceId, deviceCredential } = await setupTestProjectAndDevice();

    const res = await supertest(app)
      .delete(`/api/devices/${deviceId}`)
      .set('Authorization', `Bearer ${deviceCredential}`)
      .set('X-Device-Id', deviceId);

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.remainingActiveDevices, 0);

    // Verify device is now inactive in DB
    const updatedDevice = await Device.findById(deviceId);
    assert.equal(updatedDevice.isActive, false);

    // Verify project hasActiveDevice flag is now false
    const updatedProject = await Project.findById(project._id);
    assert.equal(updatedProject.hasActiveDevice, false);

    // Subsequent error history request with that device should now be forbidden (403)
    const blockedRes = await supertest(app)
      .get('/api/errors')
      .set('Authorization', `Bearer ${deviceCredential}`)
      .set('X-Device-Id', deviceId);

    assert.equal(blockedRes.status, 403);
  });
});

