// Channel-related commands for Cypress tests

Cypress.Commands.add('createChannel', (channelName, type = 'text') => {
  cy.get('input[placeholder="New Channel Name"]', { timeout: 5000 }).first().click();

  if (type === 'voice') {
    cy.get('button').contains('🎤 Голос').click();
  } else {
    cy.get('button').contains('# Текст').click();
  }

  cy.contains(channelName).should('be.visible');

  // Wait for channel creation backend response
  cy.cyWaitNetwork(500);
});

Cypress.Commands.add('switchToChannel', (channelName) => {
  cy.contains(channelName, { timeout: 5000 }).click();

  // Wait for channel switch to complete
  cy.cyWaitNetwork(500);
});

Cypress.Commands.add('joinChannel', (channelName) => {
  cy.switchToChannel(channelName);
});

Cypress.Commands.add('sendChannelMessage', (channelName, message) => {
  cy.joinChannel(channelName);
  cy.sendMessage(message);
});

Cypress.Commands.add('verifyChannelExists', (channelName) => {
  cy.contains(channelName).should('be.visible');
});

Cypress.Commands.add('waitForChannelMessages', (expectedCount = 1, timeout = 5000) => {
  cy.get('[data-testid="message-list"] p', { timeout }).should('have.length.greaterThan', expectedCount - 1);
});

Cypress.Commands.add('createVoiceChannel', (channelName) => {
  cy.createChannel(channelName, 'voice');
});

Cypress.Commands.add('deleteChannel', (channelName) => {
  // Implementation depends on channel deletion UI
  // This is a placeholder - adjust based on actual UI implementation
  cy.contains(channelName).rightclick();
  cy.contains('Delete').click();
  cy.contains('Confirm').click();
});

Cypress.Commands.add('renameChannel', (oldName, newName) => {
  cy.contains(oldName).rightclick();
  cy.contains('Rename').click();
  cy.get('input[type="text"]').clear().type(newName);
  // Press Enter or click save button
  cy.get('input[type="text"]').type('{enter}');
});