# Architecture Diagram

```mermaid
graph TB
    A[React Frontend] --> B[Nginx Proxy]
    B --> C[Express Backend]
    C --> D[MongoDB]
    C --> E[Redis Cache]
    F[Socket.IO] --> A
    F --> C
    G[Cypress Tests] --> A
    H[Jest Tests] --> C

    subgraph "Deployment Layers"
        I[Docker Containers]
        J[GitHub Actions CI/CD]
        K[Swagger API Docs]
    end
```

## Component Structure

### Backend
- `server.js`: Main entry point
- `models/`: Database models
- `services/`: Business logic
- `tests/`: Test suites

### Frontend
- `src/components/`: React components
- `src/hooks/`: Custom hooks
- `cypress/`: E2E tests
- `public/`: Static assets
