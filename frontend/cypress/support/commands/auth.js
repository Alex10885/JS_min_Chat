// Authentication commands for Cypress e2e tests

Cypress.Commands.add('login', (identifier, password) => {
  cy.request({
    method: 'POST',
    url: `${Cypress.env('apiUrl') || 'http://localhost:3001'}/api/login`,
    body: { identifier, password },
    failOnStatusCode: false
  }).then((response) => {
    if (response.status === 200) {
      // Store token in localStorage using correct keys
      const { token, user } = response.body;
      localStorage.setItem('chatToken', token);
      localStorage.setItem('nickname', user.nickname || user.identifier);
      localStorage.setItem('role', user.role || 'member');

      // Return for chaining
      return cy.wrap({ token, user });
    } else {
      throw new Error(`Login failed: ${response.body?.error || 'Unknown error'}`);
    }
  });
});

Cypress.Commands.add('register', (nickname, email, password) => {
  cy.request({
    method: 'POST',
    url: `${Cypress.env('apiUrl') || 'http://localhost:3001'}/api/register`,
    body: { nickname, email, password },
    failOnStatusCode: false
  }).then((response) => {
    if (response.status === 201) {
      const { token, user } = response.body;
      localStorage.setItem('chatToken', token);
      localStorage.setItem('nickname', user.nickname || nickname);
      localStorage.setItem('role', user.role || 'member');
      return cy.wrap({ token, user });
    } else {
      throw new Error(`Registration failed: ${response.body?.error || 'Unknown error'}`);
    }
  });
});

Cypress.Commands.add('loginAndSetup', (userData = null) => {
  const user = userData || {
    identifier: `cypress_user_${Date.now()}`,
    password: 'testpass123'
  };

  cy.window().then((win) => {
    // Clear any existing auth state
    win.localStorage.clear();
    win.sessionStorage.clear();
  });

  // First try login, if fails then register
  cy.request({
    method: 'POST',
    url: `${Cypress.env('apiUrl') || 'http://localhost:3001'}/api/login`,
    body: { identifier: user.identifier, password: user.password },
    failOnStatusCode: false
  }).then((loginResponse) => {
    if (loginResponse.status === 200) {
      const { token, user: userData } = loginResponse.body;
      return cy.window().then((win) => {
        win.localStorage.setItem('chatToken', token);
        win.localStorage.setItem('nickname', userData.nickname);
        win.localStorage.setItem('role', userData.role);
      });
    } else {
      // Register new user
      return cy.request({
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
          return cy.window().then((win) => {
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
    // Now visit the app and wait for it to load
    cy.visit('/', { timeout: 15000 });
    // Wait for channels to load - either General or a default channel
    cy.contains('General', { timeout: 10000 }).should('be.visible').then(() => {
      // Wait a bit more for UI to stabilize
      cy.wait(1000);
    });
  });
});

Cypress.Commands.add('logout', () => {
  cy.window().then((win) => {
    win.localStorage.clear();
    win.sessionStorage.clear();
  });
  cy.visit('/');
});

Cypress.Commands.add('ensureAuthenticated', (userData = null) => {
  const user = userData || {
    identifier: `cypress_user_${Date.now()}`,
    password: 'testpass123'
  };

  cy.window().then((win) => {
    const token = win.localStorage.getItem('chatToken');
    if (token) {
      // User is already authenticated
      return cy.wrap(true);
    } else {
      // Need to authenticate
      return cy.loginAndSetup(user);
    }
  });
});

// Helper function to create and authenticate a user
Cypress.ensureAuthenticated = (userData) => {
  const user = userData || {
    identifier: `cypress_user_${Date.now()}`,
    password: 'password123'
  };

  return cy.window().then((win) => {
    if (win.localStorage.getItem('token')) {
      return cy.wrap(true);
    }

    // Try login first
    return cy.login(user.identifier, user.password).then(
      () => cy.visit('/'),
      () => {
        // Register if login fails
        cy.register(
          user.identifier,
          `${user.identifier}@example.com`,
          user.password
        );
        cy.visit('/');
      }
    );
  });
};