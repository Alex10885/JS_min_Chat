// Common utility commands for Cypress tests

Cypress.Commands.add('waitForSocket', (socketId = null) => {
  cy.window().then((win) => {
    const checkSocketConnection = () => {
      // Check if socket connection is available and ready
      const socket = win.socket;
      if (socket && socket.connected) {
        return cy.wrap(true);
      } else {
        // Wait and retry
        cy.wait(500).then(() => checkSocketConnection());
      }
    };
    return checkSocketConnection();
  });
});

Cypress.Commands.add('waitForChannelLoad', (channelName = 'General', timeout = 10000) => {
  cy.contains(channelName, { timeout }).should('be.visible');
  // Wait for any socket events to complete
  cy.wait(500);
});

Cypress.Commands.add('clickButton', (text, options = {}) => {
  cy.contains('button', text, options).click();
});

Cypress.Commands.add('typeMessage', (message, options = {}) => {
  const selector = 'input[type="text"], textarea';
  cy.get(selector, options).clear().type(message);
});

Cypress.Commands.add('sendMessage', (message, options = {}) => {
  cy.typeMessage(message, options);
  cy.get('button').contains('Отправить').click();
});

// Custom timeout for network operations
Cypress.Commands.add('cyWaitNetwork', (timeout = 500) => {
  cy.wait(timeout);
});

Cypress.Commands.add('ensureElement', (selector, timeout = 5000) => {
  cy.get(selector, { timeout }).should('exist');
});

Cypress.Commands.add('clearThenType', (selector, text, options = {}) => {
  cy.get(selector, options).clear().type(text);
});

// Helper for handling promise-based commands
Cypress.Commands.add('thenable', (fn) => {
  return cy.wrap(null).then(() => fn());
});