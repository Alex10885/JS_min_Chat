const config = require('./index');

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: config.swagger.title,
      version: config.swagger.version,
      description: 'REST API for Chat-JS application with real-time messaging and voice channels',
      contact: {
        name: 'Chat-JS Support'
      }
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server'
      }
    ],
    components: {
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'User unique identifier'
            },
            nickname: {
              type: 'string',
              description: 'User nickname',
              minLength: 3,
              maxLength: 50
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address'
            },
            role: {
              type: 'string',
              enum: ['admin', 'member'],
              default: 'member',
              description: 'User role'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'User creation timestamp'
            },
            lastActive: {
              type: 'string',
              format: 'date-time',
              description: 'Last activity timestamp'
            },
            status: {
              type: 'string',
              enum: ['online', 'offline'],
              description: 'User online status'
            }
          },
          required: ['nickname', 'email', 'password', 'role']
        },
        Channel: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Channel unique identifier (auto-generated from name)'
            },
            name: {
              type: 'string',
              description: 'Channel display name',
              minLength: 1,
              maxLength: 100
            },
            type: {
              type: 'string',
              enum: ['text', 'voice'],
              description: 'Channel type'
            },
            description: {
              type: 'string',
              description: 'Channel description',
              maxLength: 500
            },
            createdBy: {
              type: 'string',
              description: 'Creator nickname'
            },
            position: {
              type: 'number',
              default: 0,
              description: 'Channel display position'
            }
          },
          required: ['id', 'name', 'type', 'createdBy']
        },
        RegisterRequest: {
          type: 'object',
          required: ['nickname', 'email', 'password'],
          properties: {
            nickname: {
              type: 'string',
              minLength: 3,
              maxLength: 50,
              description: 'Unique username'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'Valid email address'
            },
            password: {
              type: 'string',
              minLength: 6,
              description: 'User password'
            }
          }
        },
        LoginRequest: {
          type: 'object',
          required: ['identifier', 'password'],
          properties: {
            identifier: {
              type: 'string',
              description: 'Username or email'
            },
            password: {
              type: 'string',
              description: 'User password'
            }
          }
        },
        AuthResponse: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description: 'JWT access token'
            },
            user: {
              $ref: '#/components/schemas/User'
            }
          }
        },
        ChannelRequest: {
          type: 'object',
          required: ['name', 'type'],
          properties: {
            name: {
              type: 'string',
              minLength: 1,
              maxLength: 100,
              description: 'Channel display name'
            },
            type: {
              type: 'string',
              enum: ['text', 'voice'],
              description: 'Channel type'
            },
            description: {
              type: 'string',
              maxLength: 500,
              description: 'Optional channel description'
            }
          }
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message'
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  msg: { type: 'string' },
                  param: { type: 'string' },
                  location: { type: 'string' }
                }
              },
              description: 'Validation errors array'
            }
          }
        }
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: ['./server.js'] // Will be updated when routes are separated
};

module.exports = swaggerOptions;