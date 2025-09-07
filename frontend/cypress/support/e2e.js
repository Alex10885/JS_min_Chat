import './commands/auth';
import './commands/channel';
import './commands/common';

// Set environment variables for tests
Cypress.env('apiUrl', 'http://localhost:3001');
