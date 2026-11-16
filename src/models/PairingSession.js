// apps/server/src/models/PairingSession.js
//
// A PairingSession is created when the SDK wants to display a QR code.
// It holds a short-lived, single-use token that the mobile app must
// present to prove it scanned the correct QR code.
//
// Rules:
//   1. Tokens expire after 10 minutes (enforced by expiresAt field + TTL index).
//   2. Once consumed, the session is marked with consumedAt — it cannot be reused.
//   3. We only store the HASH of the token, never the plaintext.

'use strict';

const mongoose = require('mongoose');

const pairingSessionSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },

    // SHA-256 hash of the plaintext pairing token.
    // The plaintext token goes into the QR code, never into the database.
    tokenHash: {
      type: String,
      required: true,
    },

    // When this pairing session expires.
    // The TTL index below tells MongoDB to automatically DELETE documents
    // once this date has passed. This is automatic cleanup at the DB level.
    expiresAt: {
      type: Date,
      required: true,
    },

    // Set to the current time when a device consumes this session.
    // null means the session has not been used yet.
    consumedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// TTL (Time To Live) index: MongoDB will automatically delete pairing session
// documents when the current time passes expiresAt.
// expireAfterSeconds: 0 means "expire exactly at the expiresAt time".
pairingSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index on tokenHash for fast lookup when the mobile app submits a pairing request.
pairingSessionSchema.index({ tokenHash: 1 });

module.exports = mongoose.model('PairingSession', pairingSessionSchema);

