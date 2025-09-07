const { defineConfig } = require("cypress")

module.exports = defineConfig({
  e2e: {
    baseUrl: "http://localhost:3000",
    specPattern: [
      "cypress/e2e/critical/**/*.cy.{js,jsx,ts,tsx}",
      "cypress/e2e/important/**/*.cy.{js,jsx,ts,tsx}",
      "cypress/e2e/optional/**/*.cy.{js,jsx,ts,tsx}",
      "cypress/e2e/**/*.cy.{js,jsx,ts,tsx}"
    ],
    supportFile: "cypress/support/e2e.js",
    video: false,  // Disable video recording for performance
    screenshotOnRunFailure: true,
    videosFolder: "cypress/results/videos",
    screenshotsFolder: "cypress/results/screenshots",
    defaultCommandTimeout: 15000,
    requestTimeout: 20000,
    responseTimeout: 25000,
    viewportWidth: 1280,
    viewportHeight: 720,
    retries: {
      runMode: 2,
      openMode: 1,
    },
    numTestsKeptInMemory: 1,
    // reporter: "cypress-multi-reporters",
    // reporterOptions: {
    //   configFile: "cypress/reporter-config.json"
    // },
    setupNodeEvents(on, config) {
      // implement node event listeners here
    },
  },
  component: {
    devServer: {
      framework: "create-react-app",
      bundler: "webpack",
    },
  },
})
