describe('Critical - Authentication', () => {
  const LoginPage = require('../../page-objects/LoginPage');
  const ChatPage = require('../../page-objects/ChatPage');

  const loginPage = new LoginPage();
  const chatPage = new ChatPage();

  beforeEach(() => {
    // Clear localStorage before each test
    cy.window().then((win) => {
      win.localStorage.clear();
      win.sessionStorage.clear();
    });

    // Mock auth APIs for UI tests
    cy.intercept('POST', '**/api/login', (req) => {
      req.reply({
        statusCode: 200,
        body: {
          token: 'mock-jwt-token-for-ui-test',
          user: { nickname: req.body.identifier, role: 'member' }
        }
      });
    }).as('loginRequest');

    cy.intercept('POST', '**/api/register', (req) => {
      req.reply({
        statusCode: 201,
        body: {
          token: 'mock-jwt-token-for-ui-test',
          user: { nickname: req.body.nickname, role: 'member' }
        }
      });
    }).as('registerRequest');

    // Mock channels API for UI tests
    cy.intercept('GET', '/api/channels', {
      body: [
        { id: 'general', name: 'general', type: 'text' },
        { id: 'voice-chat', name: 'voice-chat', type: 'voice' }
      ]
    }).as('getChannels');
  });

  it('should allow new user to register and login successfully', () => {
    const userId = `cypress_user_${Date.now()}`;

    // Visit the page
    loginPage.visit().waitForPageLoad();

    // Register new user
    loginPage
      .enterNickname(userId)
      .enterEmail(`${userId}@example.com`)
      .enterPassword('testpass123')
      .clickRegister();

    // Should redirect to main app
    cy.url().should('not.include', '/#/auth');
    cy.url().should('include', Cypress.config().baseUrl);

    // Should see chat interface
    chatPage.waitForPageLoad();
  });

  it('should allow registered user to login with nickname', () => {
    const userId = `testuser${Date.now()}`;

    // First, register the user via API
    cy.request('POST', 'http://localhost:3001/api/register', {
      nickname: userId,
      email: `${userId}@example.com`,
      password: 'testpass123'
    }).then((response) => {
      expect(response.status).to.equal(201);
    });

    // Now attempt login via UI
    loginPage.visit().waitForPageLoad();

    loginPage
      .enterIdentifier(userId)
      .enterPassword('testpass123')
      .clickLogin();

    // Should redirect to main app
    cy.url().should('not.include', '/#/auth');

    // Should see chat interface
    chatPage.waitForPageLoad();
  });

  it('should reject login with invalid credentials', () => {
    loginPage.visit().waitForPageLoad();

    loginPage
      .enterIdentifier('nonexistent_user')
      .enterPassword('wrongpassword')
      .clickLogin();

    // Should show error message
    loginPage.assertErrorMessage();
  });

  it('should reject registration with missing required fields', () => {
    loginPage.visit().waitForPageLoad();

    // Try to register without nickname
    loginPage
      .enterNickname('')
      .enterEmail('test@example.com')
      .enterPassword('testpass123')
      .clickRegister();

    // Should show error - either form validation or server error
    cy.get(loginPage.selectors.errorMessage, { timeout: 5000 }).should('be.visible');
  });

  it('should handle logout and require re-authentication', () => {
    // First, ensure authenticated
    cy.loginAndSetup();

    // Logout
    cy.logout();

    // Should redirect to auth form
    cy.url().should('include', Cypress.config().baseUrl);
    cy.get(loginPage.selectors.authForm, { timeout: 5000 }).should('be.visible');
  });
});