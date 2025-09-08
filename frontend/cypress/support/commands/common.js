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

// Enhanced health check command with retries
Cypress.Commands.add('ensureBackendHealth', (maxRetries = 5) => {
  const checkHealth = (retries) => {
    cy.request({
      url: `${Cypress.env('apiUrl') || 'http://localhost:3001'}/health`,
      timeout: 10000,
      failOnStatusCode: false
    }).then((response) => {
      if (response.status === 200) {
        cy.log(`✅ Backend health check passed (attempt ${retries + 1}/${maxRetries + 1})`);
        return cy.wrap(true);
      } else if (retries > 0) {
        cy.log(`⚠️ Backend health check failed (attempt ${retries + 1}/${maxRetries + 1}), retrying in 2000ms...`);
        cy.wait(2000);
        return checkHealth(retries - 1);
      } else {
        throw new Error(`❌ Backend health check failed after ${maxRetries + 1} attempts. Status: ${response.status}`);
      }
    });
  };
  return checkHealth(maxRetries);
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
// Enhanced authentication command with health check
Cypress.Commands.add('ensureAuthenticatedWithHealth', (userData = null) => {
  const user = userData || {
    identifier: `cypress_user_${Date.now()}`,
    password: 'testpass123'
  };

  // First ensure backend is healthy
  cy.ensureBackendHealth().then(() => {
    // Now authenticate
    cy.window().then((win) => {
      const token = win.localStorage.getItem('chatToken');
      if (token) {
        // User is already authenticated, visit app
        cy.visit('/', { timeout: 20000 });
        return cy.wrap(true);
      } else {
        // Need to authenticate - use improved setup that visits page
        return cy.request({
          method: 'POST',
          url: `${Cypress.env('apiUrl') || 'http://localhost:3001'}/api/login`,
          body: { identifier: user.identifier, password: user.password },
          failOnStatusCode: false
        }).then((loginResponse) => {
          if (loginResponse.status === 200) {
            const { token, user: userData } = loginResponse.body;
            cy.window().then((win) => {
              win.localStorage.setItem('chatToken', token);
              win.localStorage.setItem('nickname', userData.nickname);
              win.localStorage.setItem('role', userData.role);
            });
          } else {
            // Register new user if login fails
            cy.request({
              method: 'POST',
              url: `${Cypress.env('apiUrl') || 'http://localhost:3001'}/api/register`,
              body: {
                nickname: user.identifier,
                email: `${user.identifier}@example.com`,
                password: user.password
              },
              failOnStatusCode: false
            }).then((registerResponse) => {
              if (registerResponse.status === 201) {
                const { token, user: userData } = registerResponse.body;
                cy.window().then((win) => {
                  win.localStorage.setItem('chatToken', token);
                  win.localStorage.setItem('nickname', userData.nickname);
                  win.localStorage.setItem('role', userData.role);
                });
              } else {
                throw new Error(`Registration failed: ${registerResponse.body?.error || 'Unknown error'}`);
              }
            });
          }
        }).then(() => {
          // Now visit the app
          cy.visit('/', { timeout: 20000 });
          // Wait for connection status to appear
          cy.contains(/Подключено|Переподключение|Отключено/, { timeout: 20000 }).should('be.visible');
          // Wait for channels to load
          cy.contains('General', { timeout: 15000 }).should('be.visible');
        });
      }
    });
  });
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