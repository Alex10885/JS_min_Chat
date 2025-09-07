const BasePage = require('./BasePage');

class LoginPage extends BasePage {
  constructor() {
    super('/');
    this.container = '.login-container, form, [data-testid="auth-form"]';

    // Define selectors
    this.selectors = {
      nicknameInput: 'input[placeholder*="nickname"], input[type="text"]:first',
      emailInput: 'input[type="email"]',
      passwordInput: 'input[type="password"]',
      loginTab: 'button, [role="tab"]:contains("Login")',
      registerTab: 'button, [role="tab"]:contains("Register")',
      submitButton: 'button[type="submit"], button:contains("Login"), button:contains("Register")',
      errorMessage: '.error, .alert, [role="alert"]',
      authForm: 'form'
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