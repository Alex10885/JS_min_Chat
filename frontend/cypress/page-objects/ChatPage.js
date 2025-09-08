const BasePage = require('./BasePage');

class ChatPage extends BasePage {
  constructor() {
    super('/');
    this.container = '.chat-app, .app-container, main';

    // Define selectors based on Material-UI and actual components
    this.selectors = {
      channelList: '.MuiGrid-item .MuiPaper-root:has(.MuiTypography-root.MuiTypography-h6:contains("Каналы"))',
      messageList: '.MuiGrid-item .MuiPaper-root:has(.MuiTypography-root:contains("Введите сообщение"))', // For message area
      messageInput: '[data-testid="message-input"]',
      sendButton: '[data-testid="send-message-button"]',
      channels: {
        general: '.MuiListItem-root:contains("general"), .MuiListItem-root:contains("#general")',
        voice: '.MuiListItem-root:contains("voice-chat"), .MuiListItem-root:contains("voice-chat")'
      },
      userList: '.MuiList-root:has(.MuiAvatar-root)',
      voiceControls: '.MuiBox-root:has(button:has-text("Выйти"))', // Near voice channel info
      connectionStatus: '.MuiAppBar-root, header',
      newChannelInput: '[data-testid="new-channel-input"]',
      createTextChannelBtn: 'button:contains("# Текст")',
      createVoiceChannelBtn: 'button:contains("🎤 Голос")',
      drawer: '.MuiDrawer-root, .MobileDrawer-open'
    };
  }

  waitForPageLoad(timeout = 10000) {
    // Wait for socket connection and channel loading
    this.elementVisible(this.selectors.channelList, timeout);
    cy.contains(/общий|general|online/i, { timeout }).should('be.visible');
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