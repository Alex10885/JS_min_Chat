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
    required: true
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

// Update timestamp on save
channelSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Remove channel method (used for deleting with checks)
channelSchema.methods.safeDelete = async function() {
  // Count messages in this channel
  const messageCount = await mongoose.model('Message').countDocuments({ channel: this.id });

  if (messageCount > 0) {
    throw new Error(`Cannot delete channel with ${messageCount} messages. Channel must be empty or archived.`);
  }

  return this.remove();
};

module.exports = mongoose.model('Channel', channelSchema);