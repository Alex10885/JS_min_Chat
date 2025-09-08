require('dotenv').config();
const serverFactory = require('./server/index');

async function main() {
  try {
    await serverFactory.start();

    console.log('🎉 Server started successfully with new architecture!');
    console.log('📋 Available endpoints:');
    console.log('   - HTTP API: http://localhost:3001/api/*');
    console.log('   - WebSocket: ws://localhost:3001');
    console.log('   - Health check: http://localhost:3001/health');
    console.log('   - API Documentation: http://localhost:3001/api-docs');

    // Graceful shutdown
    process.on('SIGINT', () => serverFactory.gracefulShutdown());
    process.on('SIGTERM', () => serverFactory.gracefulShutdown());

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start server if called directly
if (require.main === module) {
  main();
}

module.exports = serverFactory;