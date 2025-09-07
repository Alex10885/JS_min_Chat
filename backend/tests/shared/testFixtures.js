// Test fixtures for optimized backend testing
// This file provides reusable test data that reduces setup time

const { TestFixtureHelper, DatabaseTestHelper } = require('./testHelpers');
const mongoose = require('mongoose');

class TestFixtures {
  static fixtureHelper = new TestFixtureHelper();

  static async setup() {
    await DatabaseTestHelper.cleanupCollections();
    await this.loadDefaultFixtures();
  }

  static async loadDefaultFixtures() {
    // Default user fixture
    await this.fixtureHelper.create('defaultUser', async (helper) => {
      return await helper.userHelper.createUser({
        nickname: 'test_user_fixture',
        email: 'fixture@example.com',
        role: 'user'
      });
    });

    // Default channel fixture
    await this.fixtureHelper.create('defaultChannel', async (helper) => {
      return await helper.channelHelper.createChannel({
        name: 'General Fixture',
        type: 'text',
        description: 'Default test channel'
      });
    });

    // Multiple users fixture for multi-user tests
    await this.fixtureHelper.create('multipleUsers', async (helper) => {
      const users = [];
      for (let i = 1; i <= 5; i++) {
        const user = await helper.userHelper.createUser({
          nickname: `user_fixture_${i}`,
          email: `fixture_user_${i}@example.com`
        });
        users.push(user);
      }
      return users;
    });

    // Admin user fixture
    await this.fixtureHelper.create('adminUser', async (helper) => {
      return await helper.userHelper.createUser({
        nickname: 'admin_fixture',
        email: 'admin_fixture@example.com',
        role: 'admin'
      });
    });
  }

  static async getUser(name = 'defaultUser') {
    return await this.fixtureHelper.load(name);
  }

  static async getChannel(name = 'defaultChannel') {
    return await this.fixtureHelper.load(name);
  }

  static async getUsers(name = 'multipleUsers') {
    return await this.fixtureHelper.load(name);
  }

  static async cleanup() {
    await this.fixtureHelper.cleanup();
  }
}

module.exports = { TestFixtures };