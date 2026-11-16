// apps/server/src/models/Device.js
//
// A Device represents one mobile phone that has paired with a project.
// A project can have multiple devices (e.g. developer's phone + tablet).
// When we send a push notification, we send it to ALL active devices
// associated with the project that reported the error.

'use strict';

const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },

    // The Expo Push Token from the mobile device.
    // Format: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
    // This is what we pass to the Expo Push API to send notifications.
    // It can change if the user reinstalls the app, so we update it on re-pairing.
    expoPushToken: {
      type: String,
      required: true,
      trim: true,
    },

    // A friendly name for the device, e.g. "Pixel 8 Pro".
    deviceName: {
      type: String,
      trim: true,
      default: 'Unknown Device',
    },

    platform: {
      type: String,
      enum: ['android', 'ios', 'unknown'],
      default: 'unknown',
    },

    // SHA-256 hash of the device's credential.
    // The mobile app uses this credential to authenticate requests
    // for error history. select: false prevents accidental leakage.
    deviceCredentialHash: {
      type: String,
      required: true,
      select: false,
    },

    // Set to false when the device is deliberately unpaired or when
    // push notifications fail repeatedly (invalid Expo Push Token).
    isActive: {
      type: Boolean,
      default: true,
    },

    // Updated whenever the device successfully contacts the backend.
    // Useful for detecting stale devices.
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Find all active devices for a project — used when sending notifications.
deviceSchema.index({ projectId: 1, isActive: 1 });

// Ensure one device cannot register the same Expo Push Token twice
// for the same project. This handles the case where a device re-pairs
// after reinstalling the app.
deviceSchema.index({ projectId: 1, expoPushToken: 1 }, { unique: true });

module.exports = mongoose.model('Device', deviceSchema);

