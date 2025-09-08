const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  author: {
    type: String,
    required: true,
    trim: true
  },
  text: {
    type: String,
    required: true,
    maxlength: 2000
  },
  channel: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['public', 'private', 'system'],
    default: 'public'
  },
  target: {
    type: String,
    trim: true,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  status: {
    type: String,
    enum: ['delivered', 'failed'],
    default: 'delivered'
  },
  replyTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null
  }
});

// Indexes for performance and queries
messageSchema.index({ channel: 1, timestamp: -1 });
messageSchema.index({ author: 1, timestamp: -1 });
messageSchema.index({ channel: 1, type: 1, timestamp: -1 });

// For private messages
messageSchema.index({ channel: 1, author: 1, target: 1, timestamp: -1 });

// Limit history retrieval (keep recent messages)
messageSchema.pre('save', function(next) {
  if (this.isNew && this.type === 'system') {
    // System messages don't need complex processing
    return next();
  }
  next();
});

module.exports = mongoose.model('Message', messageSchema);