const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  parent: {
    type: String,
    default: null
  },
  type: {
    type: String,
    enum: ['text', 'voice'],
    required: true
  },
  description: {
    type: String,
    maxlength: 500
  },
  position: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: String,
    required: true,
    trim: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  permissions: {
    read: {
      type: String,
      enum: ['everyone', 'admin'],
      default: 'everyone'
    },
    write: {
      type: String,
      enum: ['everyone', 'admin'],
      default: 'everyone'
    }
  },
  locked: {
    type: Boolean,
    default: false
  }
});

// Indexes
channelSchema.index({ id: 1, type: 1 }); // For channel queries by type
channelSchema.index({ parent: 1 }); // For nested channels
channelSchema.index({ position: 1 }); // For ordering

// Generate unique ID from name and handle slug
channelSchema.pre('save', async function(next) {
  this.updatedAt = new Date();

  if (this.isNew && this.name && !this.id) {
    // Generate base ID from name
    let baseId = this.name.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars except spaces and hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

    // Ensure ID is not empty
    if (!baseId) {
      baseId = 'channel-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }

    // Ensure uniqueness
    let uniqueId = baseId;
    let counter = 1;
    let existing = await this.constructor.findOne({ id: uniqueId });

    while (existing) {
      uniqueId = `${baseId}-${counter}`;
      counter++;
      existing = await this.constructor.findOne({ id: uniqueId });
    }

    this.id = uniqueId;
  }

  next();
});

// Remove channel method (used for deleting with checks)
channelSchema.methods.safeDelete = async function() {
   const MessageModel = require('./Message'); // Ensure model is loaded
   // Count messages in this channel
   const messageCount = await MessageModel.countDocuments({ channel: this.id });

   if (messageCount > 0) {
     throw new Error(`Cannot delete channel with ${messageCount} messages. Channel must be empty or archived.`);
   }

   return this.deleteOne();
};

module.exports = mongoose.model('Channel', channelSchema);