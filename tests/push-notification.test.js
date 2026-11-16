// apps/server/tests/push-notification.test.js
//
// Tests for the Expo Push Notification delivery service:
//   - Dispatches to active devices for the project
//   - Project isolation (does not notify devices of other projects)
//   - Inactive device filtering
//   - Handling of invalid / unregistered tokens (DeviceNotRegistered)

'use strict';

const { test, describe, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const Project = require('../src/models/Project');
const Device = require('../src/models/Device');
const ErrorEvent = require('../src/models/ErrorEvent');
const { sendPushNotification } = require('../src/services/pushNotification');
const { connectTestDB, disconnectTestDB, clearCollections } = require('./testSetup');

let mockServer;
let mockServerUrl;
let lastReceivedPushPayload = null;
let mockResponseStatus = 200;
let mockResponseBody = { data: [{ status: 'ok', id: 'sample-ticket-id' }] };

before(async () => {
  await connectTestDB();

  // Create a local HTTP server to mock the Expo Push Service
  mockServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        lastReceivedPushPayload = JSON.parse(body);
      } catch {
        lastReceivedPushPayload = body;
      }
      res.writeHead(mockResponseStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockResponseBody));
    });
  });

  await new Promise((resolve) => {
    mockServer.listen(0, '127.0.0.1', () => {
      const port = mockServer.address().port;
      mockServerUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  if (mockServer) {
    await new Promise((resolve) => mockServer.close(resolve));
  }
  await disconnectTestDB();
});

afterEach(async () => {
  await clearCollections();
  lastReceivedPushPayload = null;
  mockResponseStatus = 200;
  mockResponseBody = { data: [{ status: 'ok', id: 'sample-ticket-id' }] };
});

describe('sendPushNotification', () => {
  test('sends push notification to all active devices of the affected project', async () => {
    const project = await Project.create({
      projectName: 'Test Backend',
      projectKeyHash: 'dummyhash',
      hasActiveDevice: true,
    });

    const device = await Device.create({
      projectId: project._id,
      expoPushToken: 'ExponentPushToken[device-one-token]',
      deviceName: 'Pixel 8',
      platform: 'android',
      deviceCredentialHash: 'dummyhash',
      isActive: true,
    });

    const errorEvent = await ErrorEvent.create({
      projectId: project._id,
      eventType: 'middleware',
      message: 'Database query timeout',
      statusCode: 504,
      route: '/api/items',
    });

    const result = await sendPushNotification(project, errorEvent, { expoPushUrl: mockServerUrl });

    assert.equal(result.sentCount, 1);
    assert.equal(result.failedCount, 0);
    assert.ok(Array.isArray(lastReceivedPushPayload));
    assert.equal(lastReceivedPushPayload.length, 1);
    assert.equal(lastReceivedPushPayload[0].to, 'ExponentPushToken[device-one-token]');
    assert.match(lastReceivedPushPayload[0].title, /504/);
    assert.match(lastReceivedPushPayload[0].body, /Database query timeout/);
    assert.equal(lastReceivedPushPayload[0].data.eventId, errorEvent._id.toString());
  });

  test('enforces project isolation: does not notify devices from other projects', async () => {
    const projectA = await Project.create({
      projectName: 'Project A',
      projectKeyHash: 'hashA',
      hasActiveDevice: true,
    });

    const projectB = await Project.create({
      projectName: 'Project B',
      projectKeyHash: 'hashB',
      hasActiveDevice: true,
    });

    // Device belongs to Project B
    await Device.create({
      projectId: projectB._id,
      expoPushToken: 'ExponentPushToken[project-b-device]',
      deviceName: 'iPhone',
      platform: 'ios',
      deviceCredentialHash: 'dummyhash',
      isActive: true,
    });

    // Error belongs to Project A (which has no devices)
    const errorEventA = await ErrorEvent.create({
      projectId: projectA._id,
      eventType: 'middleware',
      message: 'Project A broke',
      statusCode: 500,
    });

    const result = await sendPushNotification(projectA, errorEventA, { expoPushUrl: mockServerUrl });

    assert.equal(result.sentCount, 0);
    assert.equal(result.failedCount, 0);
    assert.equal(lastReceivedPushPayload, null, 'No push requests should be sent');
  });

  test('does not notify inactive devices', async () => {
    const project = await Project.create({
      projectName: 'Test Backend',
      projectKeyHash: 'dummyhash',
    });

    await Device.create({
      projectId: project._id,
      expoPushToken: 'ExponentPushToken[inactive-device]',
      deviceName: 'Old Phone',
      platform: 'android',
      deviceCredentialHash: 'dummyhash',
      isActive: false, // inactive!
    });

    const errorEvent = await ErrorEvent.create({
      projectId: project._id,
      eventType: 'middleware',
      message: 'Failed',
      statusCode: 500,
    });

    const result = await sendPushNotification(project, errorEvent, { expoPushUrl: mockServerUrl });

    assert.equal(result.sentCount, 0);
    assert.equal(lastReceivedPushPayload, null);
  });

  test('deactivates device if Expo reports DeviceNotRegistered', async () => {
    const project = await Project.create({
      projectName: 'Test Backend',
      projectKeyHash: 'dummyhash',
      hasActiveDevice: true,
    });

    const device = await Device.create({
      projectId: project._id,
      expoPushToken: 'ExponentPushToken[unregistered-token]',
      deviceName: 'Uninstalled Phone',
      platform: 'android',
      deviceCredentialHash: 'dummyhash',
      isActive: true,
    });

    const errorEvent = await ErrorEvent.create({
      projectId: project._id,
      eventType: 'middleware',
      message: 'Server error',
      statusCode: 500,
    });

    // Mock Expo response indicating token is no longer registered
    mockResponseBody = {
      data: [{
        status: 'error',
        message: '"ExponentPushToken[unregistered-token]" is not registered',
        details: { error: 'DeviceNotRegistered' },
      }],
    };

    const result = await sendPushNotification(project, errorEvent, { expoPushUrl: mockServerUrl });

    assert.equal(result.failedCount, 1);

    // Verify device was updated to isActive: false in the database
    const updatedDevice = await Device.findById(device._id);
    assert.equal(updatedDevice.isActive, false);

    // Verify project hasActiveDevice was updated to false since no active devices remain
    const updatedProject = await Project.findById(project._id);
    assert.equal(updatedProject.hasActiveDevice, false);
  });
});

