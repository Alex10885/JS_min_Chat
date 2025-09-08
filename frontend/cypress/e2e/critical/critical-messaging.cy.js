describe('Critical - Messaging Functionality', () => {
  const ChatPage = require('../../page-objects/ChatPage');

  const chatPage = new ChatPage();
  const timestamp = Date.now();

  beforeEach(() => {
    // Mock authentication and setup
    cy.window().then((win) => {
      win.localStorage.setItem('chatToken', 'test-jwt-token');
      win.localStorage.setItem('nickname', 'testuser');
      win.localStorage.setItem('role', 'member');
    });

    // Mock API calls
    cy.intercept('GET', '**/api/channels', [
      { id: 'general', name: 'general', type: 'text' },
      { id: 'test-channel', name: 'test-channel', type: 'text' }
    ]).as('getChannels');

    // Mock WebSocket for messaging
    cy.intercept('WEB_SOCKET*', (ws) => {
      ws.onmessage = (event) => {
        const data = event.data;
        if (data.includes('message')) {
          ws.send(JSON.stringify({
            message: 'Mock message response',
            timestamp: Date.now()
          }));
        }
      };
    }).as('websocket');

    cy.visit('/', { timeout: 15000 });
    chatPage.waitForPageLoad();
  });

  it('should send and display messages in text channel', () => {
    const testChannel = `critical-msg-${timestamp}`;
    const testMessage = `Critical test message ${timestamp}`;

    // Create a new channel for clean testing
    chatPage.createTextChannel(testChannel);

    // Send a message
    chatPage.sendMessage(testMessage);

    // Verify message appears in the message list
    chatPage.verifyMessageVisible(testMessage);
  });

  it('should send messages with keyboard shortcuts (Enter key)', () => {
    const testChannel = `critical-shortcut-${timestamp}`;
    const testMessage = `Shortcut message ${timestamp}`;

    // Create channel and switch to it
    chatPage.createTextChannel(testChannel);

    // Send message with Enter key
    chatPage.sendMessageWithEnter(testMessage);

    // Verify message appears
    chatPage.verifyMessageVisible(testMessage);
  });

  it('should handle multiple consecutive messages', () => {
    const testChannel = `critical-multi-${timestamp}`;

    chatPage.createTextChannel(testChannel);

    const messages = [
      `Message 1 - ${timestamp}`,
      `Message 2 - ${timestamp}`,
      `Message 3 - ${timestamp}`
    ];

    // Send multiple messages
    messages.forEach(message => {
      chatPage.sendMessage(message);
      cy.wait(500); // Brief pause between messages
    });

    // Verify all messages appear
    messages.forEach(message => {
      chatPage.verifyMessageVisible(message);
    });

    // Check minimum message count
    chatPage.verifyMessageCount(3);
  });

  it('should send messages to different channels independently', () => {
    const channel1 = `critical-chan1-${timestamp}`;
    const channel2 = `critical-chan2-${timestamp}`;
    const message1 = `Message for ${channel1} - ${timestamp}`;
    const message2 = `Message for ${channel2} - ${timestamp}`;

    // Create channels
    chatPage.createTextChannel(channel1);
    chatPage.createTextChannel(channel2);

    // Send message to first channel
    chatPage.switchToChannel(channel1);
    chatPage.sendMessage(message1);

    // Send message to second channel
    chatPage.switchToChannel(channel2);
    chatPage.sendMessage(message2);

    // Verify messages are in correct channels
    chatPage.switchToChannel(channel1);
    chatPage.verifyMessageVisible(message1);
    chatPage.shouldContainText(chatPage.selectors.messageList, channel1);

    chatPage.switchToChannel(channel2);
    chatPage.verifyMessageVisible(message2);
    chatPage.shouldContainText(chatPage.selectors.messageList, channel2);
  });

  it('should maintain message input focus after sending', () => {
    const testChannel = `critical-focus-${timestamp}`;

    chatPage.createTextChannel(testChannel);

    // Send a message
    chatPage.sendMessage(`Focus test message ${timestamp}`);

    // Verify input field retains focus
    chatPage.assertFocusOnInput();
  });

  it('should handle messages with special characters and emojis', () => {
    const testChannel = `critical-special-${timestamp}`;
    const specialMessage = `Special chars: !@#$%^&*() 🎉😀🎈 ${timestamp}`;

    chatPage.createTextChannel(testChannel);

    // Send message with special characters
    chatPage.sendMessage(specialMessage);

    // Verify message appears correctly
    chatPage.verifyMessageVisible(specialMessage);
  });
});