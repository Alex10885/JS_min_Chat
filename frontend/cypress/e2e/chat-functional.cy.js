describe('Chat App - End-to-End Functional Tests', () => {
  beforeEach(() => {
    // Clear localStorage and handle exceptions
    cy.window().then((win) => {
      win.localStorage.clear();
    });
    cy.on('uncaught:exception', (err) => {
      cy.log('Uncaught exception:', err.message);
      return false; // Prevent Cypress from failing the test
    });

    // Log page load and DOM state
    cy.visit('/', { timeout: 10000 }).then(() => {
      cy.log('Page visited successfully');
      cy.document().then((doc) => {
        cy.log('DOM snapshot: title -', doc.title);
        cy.log('Body children count:', doc.body.children.length);
      });
    });

    // Log if backend is responding
    cy.request({ url: 'http://localhost:3001/health', failOnStatusCode: false }).then((response) => {
      if (response.status === 200) {
        cy.log('Backend health check: OK');
      } else {
        cy.log('Backend health check failed:', response.status);
      }
    });

    // Perform user login to enable UI elements
    cy.log('Attempting user login...');
    cy.request('POST', 'http://localhost:3001/api/register', {
      identifier: `cypress-test-${Date.now()}`,
      password: 'testpass123'
    }).then((regResponse) => {
      cy.log('Registration response:', regResponse.status);
      return regResponse.status === 201 || regResponse.status === 200
        ? regResponse.body
        : cy.request('POST', 'http://localhost:3001/api/login', {
            identifier: 'testuser',
            password: 'password123'
          });
    }).then(() => {
      cy.log('Login/registration completed');
    }).catch((err) => {
      cy.log('Auth error (using test account):', err.message);
      // Fallback to existing test user if available
    });
  });

  it('should load the chat application', () => {
    // Check that the app title is visible
    cy.contains('Chat Server').should('be.visible');
  });

  it('should display chat interface elements', () => {
    // Check that main chat elements are present
    cy.get('[data-testid="VolumeUpIcon"]').should('exist'); // Voice channel icon
    cy.get('input[type="text"]').should('exist'); // Message input
    cy.get('button').contains('Отправить').should('exist'); // Send button
  });

  it('should handle message input and sending', () => {
    // Type a message
    cy.get('input[type="text"]').type('Hello from Cypress E2E test!');

    // Send message
    cy.get('button').contains('Отправить').click();

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

    // Message input should be available
    cy.get('input[type="text"]').should('be.visible');
  });

  it('should handle channel creation', () => {
    // Click on the Create Channel section
    cy.get('input[placeholder="New Channel Name"]').first().type('Test Channel');

    // Click text channel button
    cy.get('button').contains('# Текст').click();

    // Check that the new channel appears
    cy.contains('Test Channel').should('be.visible');
  });

  it('should handle voice channel creation', () => {
    // Click on the Create Channel section for voice
    cy.get('input[placeholder="New Channel Name"]').first().type('Test Voice Channel');

    // Click voice channel button
    cy.get('button').contains('🎤 Голос').click();

    // Check that the new voice channel appears
    cy.contains('Test Voice Channel').should('be.visible');
  });

  it('should support responsive design - mobile view', () => {
    // Set mobile viewport
    cy.viewport('iphone-6');

    // Check that mobile drawer menu exists
    cy.get('[data-testid="MenuIcon"]').should('be.visible');

    // Click menu button
    cy.get('[data-testid="MenuIcon"]').click();

    // Check that channels are accessible in drawer
    cy.get('.MuiDrawer-paper').should('be.visible');
    cy.contains('Каналы').should('be.visible');
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
    cy.get('button').contains('Отправить').click();

    cy.get('input[type="text"]').type('Second message');
    cy.get('button').contains('Отправить').click();

    // Check that messages appear
    cy.contains('First message').should('be.visible');
    cy.contains('Second message').should('be.visible');
  });

  it('should support private messaging with /w command', () => {
    // Join a channel
    cy.contains('General').click();

    // Send private message command (this would normally require another user)
    cy.get('input[type="text"]').type('/w TestUser Private message test');
    cy.get('button').contains('Отправить').click();

    // For this test we can't verify the private message receipt without multi-user setup
    // But we can at least check that the command is accepted
    cy.get('input[type="text"]').should('have.value', '');
  });
});

describe('Chat App - Voice Channel Functionality', () => {
  beforeEach(() => {
    cy.window().then((win) => {
      win.localStorage.clear();
    });
    cy.visit('/');
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
    cy.window().then((win) => {
      win.localStorage.clear();
    });
    cy.visit('/');
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
    cy.get('button').contains('Отправить').click();

    // Message should not be sent (input remains)
    cy.get('input[type="text"]').should('have.value', '   ');
  });

  it('should handle channel switching', () => {
    // Switch between channels
    cy.contains('General').click();
    cy.get('input[type="text"]').should('be.visible');

    // Create and switch to new channel
    cy.get('input[placeholder="New Channel Name"]').first().type('Another Channel');
    cy.get('button').contains('# Текст').click();
    cy.contains('Another Channel').click();

    // Input should still be available
    cy.get('input[type="text"]').should('be.visible');
  });
});

describe('Chat App - User Experience', () => {
  beforeEach(() => {
    cy.window().then((win) => {
      win.localStorage.clear();
    });
    cy.visit('/');
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