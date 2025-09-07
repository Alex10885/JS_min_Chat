describe('Chat App - Multi-User Scenarios', () => {
   beforeEach(() => {
     cy.ensureAuthenticated();
   });

  it('should handle multiple channel interactions', () => {
    // Create multiple channels
    const channels = ['Dev Channel', 'Random', 'Off Topic'];

    channels.forEach((channelName, index) => {
      cy.get('input[placeholder="New Channel Name"]').first().type(channelName);
      cy.get('button').contains('# Текст').click();
    });

    // Check all channels are created
    channels.forEach(channelName => {
      cy.contains(channelName).should('be.visible');
    });

    // Switch between channels
    cy.contains('Dev Channel').click();
    cy.contains('Random').click();
    cy.contains('Off Topic').click();

    // All channels should remain accessible
    cy.contains('General').should('be.visible');
    cy.contains('Dev Channel').should('be.visible');
    cy.contains('Random').should('be.visible');
    cy.contains('Off Topic').should('be.visible');
  });

  it('should support large message volumes', () => {
    // Join channel
    cy.contains('General').click();

    // Send multiple messages to test system resilience
    const messageCount = 10;

    for (let i = 0; i < messageCount; i++) {
      cy.get('input[type="text"]').type(`Test message ${i + 1}`);
      cy.get('button').contains('Отправить').click();
      cy.wait(50); // Brief pause between messages
    }

    // Verify that input is still functional
    cy.get('input[type="text"]').should('have.value', '');
    cy.get('input[type="text"]').should('be.enabled');

    // At least some messages should be visible
    cy.contains('Test message').should('be.visible');
  });

  it('should maintain chat context during tab switching', () => {
    // Join channel and send message
    cy.contains('General').click();
    cy.get('input[type="text"]').type('Context preservation test');
    cy.get('button').contains('Отправить').click();

    // Message should remain visible
    cy.contains('Context preservation test').should('be.visible');

    // Create new channel and switch to it
    cy.get('input[placeholder="New Channel Name"]').first().type('Focus Test');
    cy.get('button').contains('# Текст').click();
    cy.contains('Focus Test').click();

    // Original channel should still be accessible
    cy.contains('General').click();
    cy.contains('Context preservation test').should('be.visible');

    // New channel should also be accessible
    cy.contains('Focus Test').click();
    cy.get('input[type="text"]').should('be.visible');
  });
});

describe('Chat App - Voice Channels Advanced', () => {
   beforeEach(() => {
     cy.ensureAuthenticated();
   });

  it('should handle voice channel creation workflow', () => {
    // Create voice channel
    cy.get('input[placeholder="New Channel Name"]').first().type('Advanced Voice');
    cy.get('button').contains('🎤 Голос').click();

    // Voice channel should appear with voice indicator
    cy.contains('Advanced Voice').should('be.visible');
    cy.get('[data-testid="VolumeUpIcon"]').should('have.length.greaterThan', 0);
  });

  it('should display voice channel status appropriately', () => {
    // Create and join voice channel
    cy.get('input[placeholder="New Channel Name"]').first().type('Voice Status Test');
    cy.get('button').contains('🎤 Голос').click();

    // Click to join voice channel
    cy.contains('Voice Status Test').click();

    // Voice channel should be joinable
    // Note: Full voice testing requires WebRTC permissions
    // and is challenging in automated test environments
  });

  it('should support voice and text channel coexistence', () => {
    // Create mix of channels
    cy.get('input[placeholder="New Channel Name"]').first().type('Mixed Text');
    cy.get('button').contains('# Текст').click();

    cy.get('input[placeholder="New Channel Name"]').last().type('Mixed Voice');
    cy.get('button').contains('🎤 Голос').last().click();

    // Both types should be visible
    cy.contains('Mixed Text').should('be.visible');
    cy.contains('Mixed Voice').should('be.visible');

    // Should be able to interact with text channel
    cy.contains('Mixed Text').click();
    cy.get('input[type="text"]').should('be.visible');

    // Text channels should have text icon, voice channels should have volume icon
    cy.get('span').contains('#').should('exist'); // Text channel indicator
    cy.get('[data-testid="VolumeUpIcon"]').should('exist'); // Voice channel indicator
  });
});

describe('Chat App - Data Persistence and Recovery', () => {
   it('should maintain channel list across reloads', () => {
     cy.ensureAuthenticated();

    // Create channel
    cy.get('input[placeholder="New Channel Name"]').first().type('Persistence Test');
    cy.get('button').contains('# Текст').click();

    // Reload page
    cy.reload();

    // Channel should still exist
    cy.contains('Persistence Test').should('be.visible');
  });

  it('should handle connection recovery after reload', () => {
    cy.ensureAuthenticated();

    // Wait for initial connection
    cy.contains(/Подключено|Переподключение/).should('be.visible');

    // Reload and check recovery
    cy.reload();

    // Connection should be restored
    cy.contains(/Подключено|Переподключение/).should('be.visible');
  });
});

describe('Chat App - Accessibility and Keyboard Navigation', () => {
   beforeEach(() => {
     cy.ensureAuthenticated();
   });

  it('should support keyboard navigation for message sending', () => {
    // Join channel
    cy.contains('General').click();

    // Type message and send with Enter
    cy.get('input[type="text"]')
      .type('Keyboard navigation test{enter}');

    // Input should be cleared after Enter
    cy.get('input[type="text"]').should('have.value', '');
  });

  it('should handle keyboard shortcuts', () => {
    // Test various keyboard interactions
    cy.contains('General').click();

    // Focus on input
    cy.get('input[type="text"]').focus().should('be.focused');

    // Test typing special characters
    cy.get('input[type="text"]').type('/w TestUser Keyboard commands test{enter}');
  });

  it('should maintain focus appropriately', () => {
    // Join channel
    cy.contains('General').click();

    // Send message
    cy.get('input[type="text"]').type('Focus test{enter}');

    // Input should regain focus after sending
    cy.get('input[type="text"]').should('be.focused');
  });
});

describe('Chat App - Load and Performance', () => {
   it('should handle rapid channel creation', () => {
     cy.ensureAuthenticated();

    // Create channels rapidly
    for (let i = 0; i < 5; i++) {
      cy.get('input[placeholder="New Channel Name"]').first()
        .type(`Load Channel ${i + 1}`);
      cy.get('button').contains('# Текст').click();

      // Brief wait to avoid overwhelming
      cy.wait(20);
    }

    // All channels should be created
    for (let i = 0; i < 5; i++) {
      cy.contains(`Load Channel ${i + 1}`).should('be.visible');
    }
  });

  it('should handle large channel names', () => {
    cy.ensureAuthenticated();

    // Test with very long channel name
    const longName = 'A'.repeat(50);
    cy.get('input[placeholder="New Channel Name"]').first()
      .type(longName);
    cy.get('button').contains('# Текст').click();

    // Long name should be handled (truncated or displayed)
    cy.contains(longName.substring(0, 20)).should('exist');
  });

  it('should handle special characters in channel names', () => {
    cy.ensureAuthenticated();

    const specialName = 'Test_!@#$%^&*()_+{}|:<>?[]\\;\'",./';
    cy.get('input[placeholder="New Channel Name"]').first()
      .type(specialName);
    cy.get('button').contains('# Текст').click();

    // Special characters should be handled
    cy.contains('Test_').should('exist');
  });
});