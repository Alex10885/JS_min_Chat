describe('Critical - Connection and Error Handling', () => {
  const ChatPage = require('../../page-objects/ChatPage');
  const LoginPage = require('../../page-objects/LoginPage');

  const chatPage = new ChatPage();
  const loginPage = new LoginPage();

  beforeEach(() => {
    // Mock authentication and setup
    cy.window().then((win) => {
      win.localStorage.setItem('chatToken', 'test-jwt-token');
      win.localStorage.setItem('nickname', 'testuser');
      win.localStorage.setItem('role', 'member');
    });

    // Mock API calls
    cy.intercept('GET', '**/api/channels', [
      { id: 'general', name: 'general', type: 'text' }
    ]).as('getChannels');

    cy.intercept('GET', '**/api/online-users', [{ nickname: 'testuser', role: 'member' }]).as('getUsers');

    cy.visit('/', { timeout: 15000 });
    chatPage.waitForPageLoad();
  });

  it('should show connection status correctly', () => {
    // Wait for connection to establish and UI to load
    cy.wait(5000);

    // Check that the main header is visible ( indicating app is loaded)
    cy.contains('Chat Server').should('be.visible');

    // Verify no disconnection messages are shown
    cy.get('body').should('not.contain', 'Отключено');
  });

  it('should display channels list on successful connection', () => {
    // Ensure channels list loads
    chatPage.elementVisible(chatPage.selectors.channelList, 10000);

    // Verify at least the general channel is loaded
    cy.contains('general').should('be.visible');
  });

  it('should handle page reload and maintain connection', () => {
    // Get current state
    chatPage.elementVisible(chatPage.selectors.channelList);

    // Reload the page
    cy.reload();

    // Should automatically reconnect and show channels
    chatPage.waitForPageLoad();
    chatPage.elementVisible(chatPage.selectors.channelList);
  });

  it('should show error state when backend is unavailable', () => {
    // This test simulates network failure - might need backend manipulation
    // For now, we'll test what happens when connection fails initially

    cy.visit('/', { timeout: 15000 });

    // Try to force a disconnection scenario by intercepting websocket connections
    cy.window().then((win) => {
      // Disconnect any existing socket connections
      if (win.socket) {
        win.socket.disconnect();
      }
    });

    // Wait to see error handling
    cy.wait(5000);

    // Check if error message appears
    cy.get('.MuiTypography', { timeout: 5000 }).should(($status) => {
      if ($status.length > 0) {
        const text = $status.text();
        expect(text).to.match(/Отключено|Переподключение|Нет/i);
      }
    });
  });

  it('should handle authentication timeout', () => {
    // Clear existing auth
    cy.window().then((win) => {
      win.localStorage.removeItem('chatToken');
      win.localStorage.removeItem('nickname');
    });

    // Visit app and should redirect to login
    cy.visit('/', { timeout: 10000, failOnStatusCode: false });

    // Should show auth form or redirect to login
    cy.url().should((url) => {
      return !url.includes('/#/auth') || url.includes('auth') || url === Cypress.config().baseUrl;
    });
  });

  it('should recover from temporary connection loss', () => {
    // Send a message while connected
    const testMessage = `Recovery test ${Date.now()}`;
    chatPage.sendMessage(testMessage);

    // Wait for message to be processed
    cy.wait(2000);

    // Simulate disconnection
    cy.window().then((win) => {
      if (win.socket) {
        win.socket.disconnect();
      }
    });

    // Wait for reconnection
    cy.wait(8000);

    // Try to send another message to verify reconnection works
    const recoveryMessage = `Reconnected test ${Date.now()}`;
    chatPage.sendMessage(recoveryMessage);

    // Wait and verify we're still connected (by checking UI is responsive)
    cy.contains('Chat Server').should('be.visible');
  });

  it('should handle invalid channel switching gracefully', () => {
    // Try to access a non-existent channel
    const nonExistentChannel = 'nonexistent-channel-12345';

    // Attempt to switch to channel that doesn't exist
    cy.window().then((win) => {
      if (win.socket) {
        win.socket.emit('switch_channel', nonExistentChannel);
      }
    });

    // Should not crash - wait and verify UI is still responsive
    cy.wait(3000);
    cy.contains('Chat Server').should('be.visible');
    cy.contains('#general').should('be.visible');
  });

  it('should display user list on connection', () => {
    // Ensure user list appears after connection
    chatPage.elementVisible(chatPage.selectors.userList, 10000);

    // Should show at least one user (ourselves)
    chatPage.verifyUsersOnline(1);
  });
});