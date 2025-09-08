import { Pages } from '../page-objects';

describe('Chat App - Using Page Objects', () => {
  let chatPage;
  let loginPage;

  before(() => {
    loginPage = new Pages.Login();
    chatPage = new Pages.Chat();
  });

  beforeEach(() => {
    // Authenticate and land on main app
    cy.ensureAuthenticatedWithHealth();
    chatPage.waitForPageLoad();
  });

  it('should create and interact with text channels', () => {
    const channelName = `PO_Test_Channel_${Date.now()}`;

    // Create a new text channel
    chatPage.createTextChannel(channelName);

    // Switch to the new channel
    chatPage.switchToChannel(channelName);

    // Send a message in the new channel
    const message = 'Hello from Page Objects test!';
    chatPage.sendMessage(message);

    // Verify message appears
    chatPage.verifyMessageVisible(message);
  });

  it('should handle multiple channels simultaneously', () => {
    const channels = [
      `PO_Multi1_${Date.now()}`,
      `PO_Multi2_${Date.now()}`,
      `PO_Multi3_${Date.now()}`
    ];

    // Create multiple channels
    channels.forEach(channel => {
      chatPage.createTextChannel(channel);
    });

    // Switch between channels and send messages
    channels.forEach((channel, index) => {
      chatPage.switchToChannel(channel);
      chatPage.sendMessage(`Message ${index + 1} in ${channel}`);
      chatPage.verifyMessageVisible(`Message ${index + 1}`);
    });

    // Verify all channels are accessible
    channels.forEach(channel => {
      chatPage.verifyChannelExists(channel);
    });
  });

  it('should handle message input and validation', () => {
    const channelName = `PO_Input_Test_${Date.now()}`;

    chatPage.createTextChannel(channelName);
    chatPage.switchToChannel(channelName);

    // Test empty message (should not send)
    chatPage.typeText(chatPage.selectors.messageInput, '');
    cy.get(chatPage.selectors.sendButton).should('be.disabled');

    // Test message with content
    const message = 'Valid message content';
    chatPage.sendMessage(message);
    chatPage.verifyMessageVisible(message);

    // Verify input is cleared after sending
    chatPage.shouldHaveValue(chatPage.selectors.messageInput, '');
  });
});