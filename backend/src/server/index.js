const Server = require('./server');
const { closeDB } = require('../../db/connection');

class ServerFactory {
  constructor() {
    this.server = null;
  }

  createServer(options = {}) {
    if (this.server) {
      throw new Error('Server already created');
    }

    this.server = new Server(options);
    return this.server;
  }

  async start() {
    if (!this.server) {
      this.server = new Server();
    }

    try {
      await this.server.initialize();
      return this.server;
    } catch (error) {
      console.error('Failed to start server:', error);
      throw error;
    }
  }

  async stop() {
    if (this.server) {
      await this.server.shutdown();
      this.server = null;
    }
  }

  async gracefulShutdown() {
    console.log('Received shutdown signal, shutting down gracefully...');

    try {
      await this.stop();
      await closeDB();

      // Close Redis connection
      const { disconnect } = require('./config/redis');
      await disconnect();

      console.log('Server and Redis shut down gracefully');
      process.exit(0);
    } catch (error) {
      console.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }
}

module.exports = new ServerFactory();