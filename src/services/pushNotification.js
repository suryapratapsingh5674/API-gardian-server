// apps/server/src/services/pushNotification.js
//
// Sends push notifications to paired Expo devices via the Expo Push Service API.
//
// API Reference: https://docs.expo.dev/push-notifications/sending-notifications/
// Endpoint: https://exp.host/--/api/v2/push/send
//
// RESPONSIBILITIES:
//   1. Identify all active devices (isActive: true) paired with the affected project.
//   2. Build standard Expo push notification payloads.
//   3. Send push requests to the Expo Push API.
//   4. Inspect ticket responses: if a token is marked DeviceNotRegistered,
//      deactivate the device record and update project device status.
//   5. Never crash or throw unhandled exceptions to the caller.

'use strict';

const Device = require('../models/Device');
const Project = require('../models/Project');

const EXPO_PUSH_URL = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';

/**
 * sendPushNotification(project, errorEvent, options)
 *
 * Dispatches push notifications for an error event to all active devices
 * registered to the given project.
 *
 * @param {object} project     - The Project document ({ _id, projectName, ... })
 * @param {object} errorEvent  - The ErrorEvent document ({ _id, message, statusCode, route, ... })
 * @param {object} [options]   - Optional overrides (e.g. customUrl for testing)
 * @returns {Promise<{ sentCount: number, failedCount: number }>}
 */
async function sendPushNotification(project, errorEvent, options = {}) {
  try {
    const projectId = project._id;

    // 1. Find all active devices associated with this project
    const activeDevices = await Device.find({
      projectId,
      isActive: true,
    });

    if (!activeDevices || activeDevices.length === 0) {
      return { sentCount: 0, failedCount: 0 };
    }

    const targetUrl = options.expoPushUrl || process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';

    // 2. Format notifications for Expo Push Service
    const statusLabel = errorEvent.statusCode || 500;
    const projectTitle = project.projectName || 'API Guardian';
    const title = `🚨 ${projectTitle} (${statusLabel})`;

    const routePrefix = errorEvent.route ? `${errorEvent.route}: ` : '';
    const body = `${routePrefix}${errorEvent.message}`.slice(0, 160);

    const messages = activeDevices.map((device) => ({
      to: device.expoPushToken,
      sound: 'default',
      priority: 'high',
      channelId: 'api-guardian-alerts',
      title,
      body,
      data: {
        eventId: errorEvent._id ? errorEvent._id.toString() : '',
        projectId: projectId.toString(),
        statusCode: statusLabel,
        route: errorEvent.route || '',
        timestamp: errorEvent.timestamp || new Date().toISOString(),
      },
    }));

    // 3. Send HTTP request to Expo Push Service
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.warn(`[Push Notification] Expo API responded with HTTP ${response.status}: ${errorText}`);
      return { sentCount: 0, failedCount: activeDevices.length };
    }

    const result = await response.json();
    const tickets = Array.isArray(result.data) ? result.data : [result.data];

    let sentCount = 0;
    let failedCount = 0;

    // 4. Inspect tickets and handle invalid/unregistered devices
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      const device = activeDevices[i];

      if (ticket && ticket.status === 'ok') {
        sentCount++;
      } else {
        failedCount++;
        const errDetails = ticket?.details?.error;
        console.warn(`[Push Notification] Delivery failed for device ${device._id}: ${ticket?.message || errDetails || 'Unknown error'}`);

        // If the push token is no longer valid (e.g. app uninstalled), deactivate device
        // NEVER deactivate dev fallback tokens used for local Expo Go testing
        const isDevToken = device.expoPushToken && (
          device.expoPushToken.includes('dev-') ||
          device.expoPushToken.includes('expo-go')
        );

        if (errDetails === 'DeviceNotRegistered' && !isDevToken && process.env.NODE_ENV === 'production') {
          console.log(`[Push Notification] Deactivating unregistered device: ${device._id}`);
          await Device.findByIdAndUpdate(device._id, { isActive: false });

          // Check if any active devices remain for this project
          const remainingActive = await Device.countDocuments({
            projectId,
            isActive: true,
          });

          if (remainingActive === 0) {
            await Project.findByIdAndUpdate(projectId, { hasActiveDevice: false });
          }
        } else if (errDetails === 'DeviceNotRegistered') {
          console.log(`[Push Notification] Preserving development device: ${device._id}`);
        }
      }
    }

    return { sentCount, failedCount };
  } catch (err) {
    console.warn(`[Push Notification] Unexpected error sending notifications: ${err.message}`);
    return { sentCount: 0, failedCount: 0 };
  }
}

module.exports = {
  sendPushNotification,
  EXPO_PUSH_URL,
};
