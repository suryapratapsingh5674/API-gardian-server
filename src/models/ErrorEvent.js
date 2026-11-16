// apps/server/src/models/ErrorEvent.js
//
// An ErrorEvent stores a sanitized record of one error that occurred in
// the developer's Express application.
//
// SANITIZATION RULES (enforced in the route handler, not the schema):
//   - Never store: passwords, Authorization headers, cookies, API keys,
//     refresh tokens, raw request bodies.
//   - Safe to store: error message, safe stack trace, status code, route path.

'use strict';

const mongoose = require('mongoose');

const errorEventSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },

    // 'middleware' = reported automatically by the Express error middleware
    // 'manual'     = reported explicitly via guardian.captureError()
    eventType: {
      type: String,
      enum: ['middleware', 'manual'],
      required: true,
    },

    // The error message from error.message. Capped at 500 characters.
    message: {
      type: String,
      required: true,
      maxlength: 500,
    },

    // A sanitized stack trace. We strip any lines containing file paths
    // that include 'node_modules' to reduce noise, and cap the length.
    safeStack: {
      type: String,
      maxlength: 3000,
    },

    // HTTP status code, if applicable (e.g. 500, 503).
    statusCode: {
      type: Number,
    },

    // The route path that was being handled, e.g. '/api/users/:id'.
    // We store the route pattern, not the actual URL, to avoid leaking IDs.
    route: {
      type: String,
      maxlength: 200,
    },

    // A UUID or short ID that correlates this event across logs.
    // The SDK generates this and attaches it to its own logs.
    correlationId: {
      type: String,
    },

    // When the error occurred in the developer's app.
    // We use a separate timestamp (not createdAt) so that the actual
    // error time is preserved even if there is a reporting delay.
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Look up error history for a project, newest first.
errorEventSchema.index({ projectId: 1, timestamp: -1 });

module.exports = mongoose.model('ErrorEvent', errorEventSchema);

