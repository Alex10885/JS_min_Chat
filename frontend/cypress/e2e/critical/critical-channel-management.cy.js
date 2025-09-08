describe('Critical - Channel Management', () => {
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
      { id: 'voice-chat', name: 'voice-chat', type: 'voice' }
    ]).as('getChannels');

    cy.intercept('POST', '**/api/channels', { id: 'new-channel-id', name: 'test-channel', type: 'text' }).as('createChannel');

    // Visit the app
    cy.visit('/', { timeout: 15000 });
    chatPage.waitForPageLoad();
  });

  it('should create text channel successfully', () => {
    const channelName = `critical-text-${timestamp}`;

    chatPage.createTextChannel(channelName);

    // Verify channel appears in list
    chatPage.verifyChannelExists(channelName);

    // Switch to the new channel
    chatPage.switchToChannel(channelName);

    // Verify we're in the correct channel (should be able to send messages)
    chatPage.shouldContainText(chatPage.selectors.messageList, channelName);
  });

  it('should create voice channel successfully', () => {
    const channelName = `critical-voice-${timestamp}`;

    chatPage.createVoiceChannel(channelName);

    // Verify channel appears in list
    chatPage.verifyChannelExists(channelName);

    // Switch to the new voice channel
    chatPage.switchToChannel(channelName);

    // Voice channels should show different styling or indicators
    chatPage.getWithin(chatPage.selectors.voiceControls).should('exist');
  });

  it('should switch between channels properly', () => {
    const channel1 = `critical-chan1-${timestamp}`;
    const channel2 = `critical-chan2-${timestamp}`;

    // Create two text channels
    chatPage.createTextChannel(channel1);
    chatPage.createTextChannel(channel2);

    // Switch to first channel
    chatPage.switchToChannel(channel1);
    chatPage.shouldContainText(chatPage.selectors.messageList, channel1);

    // Switch to second channel
    chatPage.switchToChannel(channel2);
    chatPage.shouldContainText(chatPage.selectors.messageList, channel2);
  });

  it('should display default general channel on login', () => {
    // General channel should always be present
    chatPage.verifyChannelExists('General');

    // Should be able to switch to it
    chatPage.switchToChannel('General');
    chatPage.shouldContainText(chatPage.selectors.messageList, 'General');
  });

  it('should handle channel creation with special characters', () => {
    const channelName = `test-chan-special-${timestamp}!@#$`;

    // Create channel with special characters
    chatPage
      .typeText(chatPage.selectors.newChannelInput, channelName)
      .clickElement(chatPage.selectors.createTextChannelBtn);

    // Verify it appears (may need to be sanitized on backend)
    cy.contains(channelName.replace(/[!@#$]/g, '')).should('exist');
  });
});