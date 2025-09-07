// Base Page Object class for Cypress
class BasePage {
  /**
   * @param {string} url - The URL path for the page
   */
  constructor(url = '') {
    this.url = url;
    this.elements = {};
  }

  /**
   * Visit the page
   */
  visit() {
    cy.visit(this.url);
    return this;
  }

  /**
   * Wait for the page to load
   * Override this method in subclasses for specific loading indicators
   */
  waitForPageLoad(timeout = 10000) {
    return this;
  }

  /**
   * Get an element by selector with timeout
   * @param {string} selector
   * @param {number} timeout
   */
  get(selector, timeout = 5000) {
    return cy.get(selector, { timeout });
  }

  /**
   * Get element within the page's container if defined
   * @param {string} selector
   * @param {number} timeout
   */
  getWithin(selector, timeout = 5000) {
    if (this.container) {
      return cy.get(this.container).find(selector, { timeout });
    }
    return this.get(selector, timeout);
  }

  /**
   * Check if element exists
   * @param {string} selector
   * @param {number} timeout
   */
  elementExists(selector, timeout = 5000) {
    return cy.get(selector, { timeout }).should('exist');
  }

  /**
   * Check if element is visible
   * @param {string} selector
   * @param {number} timeout
   */
  elementVisible(selector, timeout = 5000) {
    return cy.get(selector, { timeout }).should('be.visible');
  }

  /**
   * Click on an element
   * @param {string} selector
   */
  clickElement(selector) {
    this.getWithin(selector).click();
    return this;
  }

  /**
   * Type text into an element
   * @param {string} selector
   * @param {string} text
   * @param {boolean} clearFirst
   */
  typeText(selector, text, clearFirst = true) {
    const element = this.getWithin(selector);
    if (clearFirst) {
      element.clear();
    }
    element.type(text);
    return this;
  }

  /**
   * Assert element contains text
   * @param {string} selector
   * @param {string} text
   */
  shouldContainText(selector, text) {
    this.getWithin(selector).should('contain', text);
    return this;
  }

  /**
   * Assert element has specific value
   * @param {string} selector
   * @param {string} value
   */
  shouldHaveValue(selector, value) {
    this.getWithin(selector).should('have.value', value);
    return this;
  }

  /**
   * Assert element is enabled
   * @param {string} selector
   */
  shouldBeEnabled(selector) {
    this.getWithin(selector).should('be.enabled');
    return this;
  }

  /**
   * Assert element is disabled
   * @param {string} selector
   */
  shouldBeDisabled(selector) {
    this.getWithin(selector).should('be.disabled');
    return this;
  }

  /**
   * Wait for network request
   * @param {string} method
   * @param {string} url
   * @param {number} timeout
   */
  waitForNetworkRequest(method, url, timeout = 10000) {
    cy.intercept(method, url).as('networkRequest');
    return cy.wait('@networkRequest', { timeout });
  }

  /**
   * Wait for various loading states
   */
  waitForNetworkIdle(timeout = 5000) {
    cy.wait(timeout);
    return this;
  }
}

module.exports = BasePage;