const BasePage = require('./BasePage');

class ChatPage extends BasePage {
  constructor() {
    super('/');
    this.container = '.MuiGrid-container';

    // Define selectors based on Material-UI and actual components
    this.selectors = {
      channelList: '.MuiAccordion-root .MuiListItem-root', // Channels in accordion
      messageList: '.MuiBox-root .MuiTypography-root', // Message content area within Paper
      messageInput: '[data-testid="message-input"] input', // Input element inside TextField
      sendButton: '[data-testid="send-message-button"]', // Actual data-testid present
      channels: {
        general: '.MuiListItem-root:contains("general"), .MuiTypography:contains("general")',
        voice: '.MuiListItem-root:contains("Выйти"), .MuiTypography:contains("Голосовой канал")'
      },
      userList: '.MuiList-root', // User list - direct selector for the users List component
      voiceControls: '.MuiBox-root button:contains("Выйти")', // Voice controls with exit button
      connectionStatus: '[data-testid="MenuIcon"], .MuiTypography', // Connection status - greater chance of finding in header area
      newChannelInput: '[data-testid="new-channel-input"]', // Actual data-testid present
      createTextChannelBtn: 'button:contains("# Текст")',
      createVoiceChannelBtn: 'button:contains("🎤 Голос")',
      drawer: '.MuiDrawer-root'
    };
  }

  waitForPageLoad(timeout = 10000) {
    // Wait for socket connection and channel loading
    cy.contains("Каналы", { timeout }).should('be.visible');
    cy.contains(/general|Общий|Пользователи онлайн|online/i, { timeout }).should('be.visible');
    return this;
  }

  // Channel operations
  switchToChannel(channelName) {
    cy.contains(channelName, { timeout: 5000 }).click();
    cy.wait(500); // Allow channel switch time
    return this;
  }

  createTextChannel(channelName) {
    this.typeText(this.selectors.newChannelInput, channelName);
    cy.get(this.selectors.createTextChannelBtn).click();
    this.shouldContainText(this.selectors.channelList, channelName);
    return this;
  }

  createVoiceChannel(channelName) {
    this.typeText(this.selectors.newChannelInput, channelName);
    cy.get(this.selectors.createVoiceChannelBtn).click();
    this.shouldContainText(this.selectors.channelList, channelName);
    return this;
  }

  verifyChannelExists(channelName) {
    this.shouldContainText(this.selectors.channelList, channelName);
    return this;
  }

  // Message operations
  sendMessage(message) {
    this.typeText(this.selectors.messageInput, message);
    cy.get(this.selectors.sendButton).click();
    this.shouldContainText(this.selectors.messageList, message);
    return this;
  }

  sendMessageToChannel(channelName, message) {
    this.switchToChannel(channelName);
    this.sendMessage(message);
    return this;
  }

  verifyMessageVisible(messageText, timeout = 5000) {
    this.shouldContainText(this.selectors.messageList, messageText);
    return this;
  }

  verifyMessageCount(count, timeout = 5000) {
    cy.get(this.selectors.messageList).find('p, .message, [data-testid="message"]').should('have.length.greaterThan', count - 1);
    return this;
  }

  // User operations
  verifyUserOnline(userNickname) {
    this.shouldContainText(this.selectors.userList, userNickname);
    return this;
  }

  verifyUsersOnline(count = 1) {
    cy.get(`${this.selectors.userList} .user, ${this.selectors.userList} li`).should('have.length.greaterThan', count - 1);
    return this;
  }

  // Voice operations
  joinVoiceChannel(channelName) {
    this.switchToChannel(channelName);
    // Implementation depends on actual UI - may need voice permission handling
    cy.get(`${this.selectors.voiceControls} button:contains("Join Voice")`, { timeout: 5000 }).click();
    return this;
  }

  leaveVoiceChannel() {
    cy.get(`${this.selectors.voiceControls} button:contains("Leave Voice")`).click();
    return this;
  }

  toggleMute() {
    cy.get(`${this.selectors.voiceControls} button:contains("Mute"), ${this.selectors.voiceControls} button:contains("Unmute")`).click();
    return this;
  }

  // Connection status
  verifyConnected() {
    this.shouldContainText(this.selectors.connectionStatus, 'connected');
    return this;
  }

  verifyDisconnected() {
    this.shouldContainText(this.selectors.connectionStatus, 'disconnected');
    return this;
  }

  // Mobile/Drawer operations
  openDrawer() {
    cy.get(`${this.selectors.drawer} button, .drawer-toggle`).click();
    return this;
  }

  closeDrawer() {
    cy.get('.drawer-backdrop, .drawer-close').click();
    return this;
  }

  // Keyboard shortcuts
  sendMessageWithEnter(message) {
    this.typeText(this.selectors.messageInput, `${message}{enter}`);
    return this;
  }

  assertFocusOnInput() {
    cy.get(this.selectors.messageInput).should('be.focused');
    return this;
  }

  // Helper methods
  waitForMessages(count = 1, timeout = 10000) {
    cy.get(`${this.selectors.messageList} p, ${this.selectors.messageList} .message`, { timeout }).should('have.length.greaterThan', count - 1);
    return this;
  }

  clearMessages() {
    cy.window().then((win) => {
      const event = new win.Event('storage');
      event.key = 'clear-messages';
      event.newValue = 'true';
      win.dispatchEvent(event);
    });
    return this;
  }
}

module.exports = ChatPage;