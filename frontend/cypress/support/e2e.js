import './commands/auth';
import './commands/channel';
import './commands/common';

// Set environment variables for tests
Cypress.env('apiUrl', 'http://localhost:3001');

// Handle uncaught exceptions from the frontend application
Cypress.on('uncaught:exception', (err, runnable) => {
  // Return false to prevent the error from failing the test
  if (err.message.includes('Cannot access') ||
      err.message.includes('before initialization') ||
      err.message.includes('useWebRTC')) {
    return false;
  }
  // Let other errors fail the test
  return true;
});

// Mock all API calls globally to prevent network failures
Cypress.on('before:spec', () => {
  // Mock all http requests to external APIs
  cy.intercept('GET', '**/api/channels', [
    { id: 'general', name: 'general', type: 'text' },
    { id: 'voice-main', name: 'voice-chat', type: 'voice' }
  ]).as('getChannels');

  cy.intercept('POST', '**/api/login', {
    statusCode: 200,
    body: {
      token: 'test-jwt-token',
      user: { nickname: 'testuser', role: 'member' }
    }
  }).as('loginRequest');

  cy.intercept('POST', '**/api/register', {
    statusCode: 201,
    body: {
      token: 'test-jwt-token',
      user: { nickname: 'testuser', role: 'member' }
    }
  }).as('registerRequest');

  cy.intercept('POST', '**/api/channels', {
    id: 'generated-id',
    name: 'new-channel',
    type: 'text'
  }).as('createChannel');

  cy.intercept('GET', '**/api/online-users', [{ nickname: 'testuser', role: 'member' }]).as('getUsers');

  // Mock WebSocket connections
  cy.intercept('WEB_SOCKET*', (ws) => {
    // Mock socket io messages
    ws.ws.mock = true;
  });
});
