// apps/server/src/models/Project.js
//
// A Project represents one developer's Express application.
// When a developer runs `createGuardian()` for the first time,
// the SDK calls the backend to register a new project.
//
// The API key is generated here and returned to the SDK once.
// We only store the HASH — the plaintext key is never saved to the database.

'use strict';

const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema(
  {
    projectName: {
      type: String,
      required: [true, 'projectName is required'],
      trim: true,
      minlength: [1, 'projectName cannot be empty'],
      maxlength: [100, 'projectName cannot exceed 100 characters'],
    },

    // The SHA-256 hash of the project's API key.
    // 'select: false' means this field is EXCLUDED from query results by default.
    // You must explicitly request it: Project.findById(id).select('+projectKeyHash')
    // This prevents the hash from accidentally leaking into API responses.
    projectKeyHash: {
      type: String,
      required: true,
      select: false,
    },

    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },

    // Set to true once at least one device has completed pairing.
    // The SDK checks this to decide whether to display the QR code.
    hasActiveDevice: {
      type: Boolean,
      default: false,
    },
  },
  {
    // Mongoose automatically adds createdAt and updatedAt timestamps.
    timestamps: true,
  }
);

// Index on status to make queries for active projects fast.
projectSchema.index({ status: 1 });

module.exports = mongoose.model('Project', projectSchema);

