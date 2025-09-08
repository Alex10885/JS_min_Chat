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

// Optimized indexes for performance and queries
messageSchema.index({ channel: 1, timestamp: -1 }); // For channel history
messageSchema.index({ channel: 1, type: 1, timestamp: -1 }); // For filtered queries
messageSchema.index({ author: 1, timestamp: -1 }); // For user message history

// Compound index for private messages with pagination
messageSchema.index({ channel: 1, author: 1, target: 1, timestamp: -1 });

// Text index for message search (optional, for future features)
// messageSchema.index({ text: 'text' });

// Index for reply relationships
messageSchema.index({ replyTo: 1 });

// Index for message counting and cleanup
messageSchema.index({ channel: 1, createdAt: -1 }); // Alternative to direct timestamp

// Limit history retrieval (keep recent messages)
messageSchema.pre('save', function(next) {
  if (this.isNew && this.type === 'system') {
    // System messages don't need complex processing
    return next();
  }
  next();
});

module.exports = mongoose.model('Message', messageSchema);