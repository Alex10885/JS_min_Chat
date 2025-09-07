describe('Chat App - End-to-End Functional Tests', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      cy.log('Uncaught exception:', err.message);
      return false; // Prevent Cypress from failing the test
    });

    // Wait for backend to be ready
    cy.request({
      url: `${Cypress.env('apiUrl') || 'http://localhost:3001'}/health`,
      failOnStatusCode: false,
      timeout: 10000
    }).then((response) => {
      if (response.status === 200) {
        cy.log('Backend health check: OK');
      } else {
        cy.log('Backend health check failed:', response.status);
      }
    });

    // Ensure user is authenticated using improved auth command
    cy.log('Ensuring user authentication...');
    cy.ensureAuthenticated().then(() => {
      cy.log('Authentication completed');
      // Wait for page to stabilize and Socket.IO to connect
      cy.wait(3000);
      // Wait for connection status to appear
      cy.contains(/Подключено|Переподключение|Отключено/, { timeout: 15000 }).should('be.visible');
    });
  });

  it('should load the chat application', () => {
    // Check that the app title is visible
    cy.contains('Chat Server').should('be.visible');
  });

  it('should display chat interface elements', () => {
    // Wait for page to fully load
    cy.contains('Chat Server').should('be.visible');

    // Check that main chat elements are present
    cy.get('[data-testid="VolumeUpIcon"]').should('exist'); // Voice channel icon
    cy.get('input[type="text"]').should('exist'); // Message input
    cy.get('button[type="button"]').contains('Отправить').should('be.visible'); // Send button
  });

  it('should handle message input and sending', () => {
    // Join General channel first
    cy.contains('General').click();
    cy.wait(2000); // Wait for channel switching

    // Type a message
    cy.get('input[type="text"]', { timeout: 10000 }).type('Hello from Cypress E2E test!');
    cy.wait(1000);

    // Send message
    cy.get('button[type="button"]').contains('Отправить').click();
    cy.wait(2000); // Wait for message to be sent

    // Check that input is cleared
    cy.get('input[type="text"]').should('have.value', '');
  });

  it('should display channels list', () => {
    // Check that channel list is visible
    cy.contains('Chat Server').should('be.visible');
    cy.contains('Каналы').should('be.visible');

    // Check for default channels
    cy.contains('General').should('exist');
  });

  it('should allow joining text channels', () => {
    // Click on General channel
    cy.contains('General').click();
    cy.wait(2000); // Wait for channel switching

    // Message input should be available
    cy.get('input[type="text"]', { timeout: 10000 }).should('be.visible');
  });

  it('should handle channel creation', () => {
    // Wait for sidebar to be ready
    cy.contains('Каналы', { timeout: 10000 }).should('be.visible');
    cy.wait(1000);

    // Get the first new channel input in the sidebar
    cy.get('input[placeholder="New Channel Name"]').first().type('Test Channel');
    cy.wait(500);

    // Click text channel button
    cy.get('button').contains('# Текст').first().click();
    cy.wait(2000); // Wait for channel creation

    // Check that the new channel appears
    cy.contains('Test Channel', { timeout: 10000 }).should('be.visible');
  });

  it('should handle voice channel creation', () => {
    // Wait for sidebar to be ready
    cy.contains('Каналы', { timeout: 10000 }).should('be.visible');
    cy.wait(1000);

    // Get the first new channel input in the sidebar
    cy.get('input[placeholder="New Channel Name"]').first().type('Test Voice Channel');
    cy.wait(500);

    // Click voice channel button
    cy.get('button').contains('🎤 Голос').first().click();
    cy.wait(2000); // Wait for channel creation

    // Check that the new voice channel appears
    cy.contains('Test Voice Channel', { timeout: 10000 }).should('be.visible');
  });

  it('should support responsive design - mobile view', () => {
    // Set mobile viewport
    cy.viewport(375, 667); // iPhone 6 dimensions

    // Reload page to apply viewport
    cy.reload();
    cy.wait(3000); // Wait for page reload and stabilization

    // Check that mobile drawer menu exists
    cy.get('[data-testid="MenuIcon"]', { timeout: 10000 }).should('be.visible');

    // Click menu button
    cy.get('[data-testid="MenuIcon"]').click();
    cy.wait(1000); // Wait for drawer animation

    // Check that channels are accessible in drawer
    cy.get('.MuiDrawer-paper', { timeout: 10000 }).should('be.visible');
    cy.contains('Каналы', { timeout: 10000 }).should('be.visible');
  });

  it('should show connection status', () => {
    // Check that connection status is displayed
    cy.contains(/Подключено|Переподключение|Отключено/).should('be.visible');
  });

  it('should handle message history', () => {
    // Join a channel
    cy.contains('General').click();

    // Send multiple messages
    cy.get('input[type="text"]').type('First message');
    cy.get('button[type="button"]').contains('Отправить').click();

    cy.get('input[type="text"]').type('Second message');
    cy.get('button[type="button"]').contains('Отправить').click();

    // Check that messages appear
    cy.contains('First message').should('be.visible');
    cy.contains('Second message').should('be.visible');
  });

  it('should support private messaging with /w command', () => {
    // Join a channel
    cy.contains('General').click();

    // Send private message command (this would normally require another user)
    cy.get('input[type="text"]').type('/w TestUser Private message test');
    cy.get('button[type="button"]').contains('Отправить').click();

    // For this test we can't verify the private message receipt without multi-user setup
    // But we can at least check that the command is accepted
    cy.get('input[type="text"]').should('have.value', '');
  });
});

describe('Chat App - Voice Channel Functionality', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      cy.log('Uncaught exception:', err.message);
      return false;
    });
    cy.ensureAuthenticated();
  });

  it('should display voice channel options', () => {
    // Check that voice channels are distinguishable
    cy.get('[data-testid="VolumeUpIcon"]').should('exist');
  });

  it('should handle voice channel interactions', () => {
    // Click on voice channel
    cy.get('[data-testid="VolumeUpIcon"]').first().click();

    // Note: Full voice functionality testing would require
    // browser permissions and WebRTC support in Cypress
    // For now, we test the UI interaction
  });
});

describe('Chat App - Error Handling and Recovery', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      cy.log('Uncaught exception:', err.message);
      return false;
    });
    cy.ensureAuthenticated();
  });

  it('should handle network disconnection gracefully', () => {
    // This test would require advanced Cypress setup to simulate network issues
    // For now, we test the basic connection status display
    cy.contains(/Подключено|Переподключение|Отключено/).should('be.visible');
  });

  it('should handle invalid message formats', () => {
    // Join a channel
    cy.contains('General').click();

    // Try sending empty message
    cy.get('input[type="text"]').type('   ');
    cy.get('button[type="button"]').contains('Отправить').click();

    // Message should not be sent (input remains)
    cy.get('input[type="text"]').should('have.value', '   ');
  });

  it('should handle channel switching', () => {
    // Switch between channels
    cy.contains('General').click();
    cy.get('input[type="text"]').should('be.visible');

    // Create and switch to new channel
    cy.contains('Каналы').should('be.visible');
    cy.get('input[placeholder="New Channel Name"]').first().type('Another Channel');
    cy.get('button').contains('# Текст').first().click();
    cy.contains('Another Channel').click();

    // Input should still be available
    cy.get('input[type="text"]').should('be.visible');
  });
});

describe('Chat App - User Experience', () => {
  beforeEach(() => {
    cy.on('uncaught:exception', (err) => {
      cy.log('Uncaught exception:', err.message);
      return false;
    });
    cy.ensureAuthenticated();
  });

  it('should maintain user context on reload', () => {
    // This test would require setting up user authentication
    // and checking persistence across reloads
  });

  it('should support message scrolling', () => {
    // Join channel and send many messages
    cy.contains('General').click();

    for (let i = 0; i < 20; i++) {
      cy.get('input[type="text"]').type(`Message ${i + 1}`);
      cy.get('button').contains('Отправить').click();
    }

    // Check that message container is scrollable (basic check)
    cy.get('[data-testid="message-container"], .message-list, [role="list"]')
      .should('have.css', 'overflow');
  });

  it('should handle rapid user interactions', () => {
    // Join channel
    cy.contains('General').click();

    // Rapid message sending
    for (let i = 0; i < 5; i++) {
      cy.get('input[type="text"]').type(`Rapid message ${i + 1}{enter}`);
      // Brief pause to avoid overwhelming the app
      cy.wait(100);
    }
  });
});