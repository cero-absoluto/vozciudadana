import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import { config } from 'dotenv';

import protestRoutes from './routes/protests.js';
import userRoutes from './routes/users.js';

config();

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
});
await app.register(sensible);

app.register(protestRoutes, { prefix: '/api/protests' });
app.register(userRoutes,    { prefix: '/api/users' });

app.get('/health', async () => ({ status: 'ok' }));

const port = Number(process.env.PORT) || 3000;
await app.listen({ port, host: '0.0.0.0' });
