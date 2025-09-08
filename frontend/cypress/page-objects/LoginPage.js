const BasePage = require('./BasePage');

class LoginPage extends BasePage {
  constructor() {
    super('/');
    this.container = '[role="dialog"] .MuiDialog-paper, form, [role="presentation"]';

    // Define selectors for Material-UI AuthForm
    this.selectors = {
      nicknameInput: 'form input[type="text"]', // First text input for nickname
      emailInput: 'form input[type="email"]',
      passwordInput: 'form input[type="password"]',
      identifierInput: 'form input[type="text"]:not([aria-label="Nickname"])', // For login mode
      loginTab: '[role="tab"]:contains("Login")',
      registerTab: '[role="tab"]:contains("Register")',
      submitButton: '[role="dialog"] button[type="submit"]',
      errorMessage: '[role="dialog"] .MuiTypography-colorError, [role="dialog"] p.MuiTypography-body2[style*="color: red"]',
      authForm: '[data-testid="auth-form"]',
      dialog: '[role="dialog"]'
    };
  }

  visit() {
    cy.visit(this.url);
    cy.clearLocalStorage();
    return this;
  }

  waitForPageLoad(timeout = 5000) {
    this.elementVisible(this.selectors.authForm, timeout);
    return this;
  }

  switchToLoginTab() {
    cy.get(this.selectors.loginTab).then($tab => {
      if (!$tab.hasClass('active, selected')) {
        cy.wrap($tab).click();
      }
    });
    return this;
  }

  switchToRegisterTab() {
    cy.get(this.selectors.registerTab).click();
    return this;
  }

  enterIdentifier(identifier) {
    this.typeText(this.selectors.nicknameInput, identifier);
    return this;
  }

  enterNickname(nickname) {
    this.typeText(this.selectors.nicknameInput, nickname);
    return this;
  }

  enterEmail(email) {
    this.typeText(this.selectors.emailInput, email);
    return this;
  }

  enterPassword(password) {
    this.typeText(this.selectors.passwordInput, password);
    return this;
  }

  clickLogin() {
    // First switch to login tab
    this.switchToLoginTab();
    // Then submit
    cy.get(this.selectors.submitButton).contains(/Login|Войти/).click();
    return this;
  }

  clickRegister() {
    // First switch to register tab
    this.switchToRegisterTab();
    // Then submit
    cy.get(this.selectors.submitButton).contains(/Register|Регистрация/).click();
    return this;
  }

  login(identifier, password) {
    this.enterIdentifier(identifier);
    this.enterPassword(password);
    this.clickLogin();
    return this;
  }

  register(nickname, email, password) {
    this.enterNickname(nickname);
    this.enterEmail(email);
    this.enterPassword(password);
    this.clickRegister();
    return this;
  }

  assertErrorMessage(message = null) {
    this.elementVisible(this.selectors.errorMessage);
    if (message) {
      this.shouldContainText(this.selectors.errorMessage, message);
    }
    return this;
  }

  assertLoginSuccessful() {
    // Should redirect or change to main app
    cy.url().should('not.equal', Cypress.config().baseUrl + '/');
    cy.shouldNotContain(this.selectors.authForm);
    return this;
  }

  assertRegisterSuccessful() {
    cy.url().should('not.equal', Cypress.config().baseUrl + '/');
    cy.shouldNotContain(this.selectors.authForm);
    return this;
  }
}

module.exports = LoginPage;