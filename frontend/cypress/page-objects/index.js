// Page Objects export index
const BasePage = require('./BasePage');
const LoginPage = require('./LoginPage');
const ChatPage = require('./ChatPage');

// Page objects instances for reuse
const loginPage = new LoginPage();
const chatPage = new ChatPage();

// Export both classes and instances
module.exports = {
  BasePage,
  LoginPage,
  ChatPage,
  Instances: {
    loginPage,
    chatPage
  },
  Pages: {
    Login: LoginPage,
    Chat: ChatPage
  }
};