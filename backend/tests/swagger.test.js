const request = require('supertest');
const express = require('express');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

// Create test app with Swagger
const app = express();

// Swagger setup (minimal for testing)
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: { title: 'Test API', version: '1.0.0' }
  },
  apis: []
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

describe('Swagger Documentation', () => {
  it('should return Swagger JSON spec', async () => {
    const response = await request(app)
      .get('/api-docs.json')
      .expect(200);

    expect(response.body).toHaveProperty('openapi', '3.0.0');
    expect(response.body).toHaveProperty('info');
    expect(response.body.info).toHaveProperty('title', 'Test API');
  });

  it('should serve Swagger UI', async () => {
    const response = await request(app)
      .get('/api-docs')
      .expect(200);

    expect(response.text).toContain('Swagger');
  });
});