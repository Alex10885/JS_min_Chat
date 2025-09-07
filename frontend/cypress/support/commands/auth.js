// Authentication commands for Cypress e2e tests

Cypress.Commands.add('login', (identifier, password) => {
  cy.request({
    method: 'POST',
    url: '/login',
    body: { identifier, password },
    failOnStatusCode: false
  }).then((response) => {
    if (response.status === 200) {
      // Store token in localStorage
      const { token, user } = response.body;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));

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
    url: '/register',
    body: { nickname, email, password },
    failOnStatusCode: false
  }).then((response) => {
    if (response.status === 201) {
      const { token, user } = response.body;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      return cy.wrap({ token, user });
    } else {
      throw new Error(`Registration failed: ${response.body?.error || 'Unknown error'}`);
    }
  });
});

Cypress.Commands.add('loginAndSetup', (userData = null) => {
  const user = userData || {
    identifier: `testuser_${Date.now()}`,
    password: 'password123'
  };

  cy.window().then((win) => {
    // Clear any existing auth state
    win.localStorage.clear();
    win.sessionStorage.clear();
  });

  cy.visit('/');

  cy.login(user.identifier, user.password).catch(() => {
    // User doesn't exist, try to register
    const registerData = {
      nickname: user.identifier,
      email: `${user.identifier}@test.com`,
      password: user.password
    };
    cy.register(registerData.nickname, registerData.email, registerData.password);
  }).then(() => {
    cy.visit('/');
    // Wait for app to load and show main interface
    cy.contains(/общий|general/i, { timeout: 10000 }).should('be.visible');
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
    identifier: `testuser_${Date.now()}`,
    password: 'password123'
  };

  cy.window().then((win) => {
    const token = win.localStorage.getItem('token');
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