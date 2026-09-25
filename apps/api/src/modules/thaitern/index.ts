import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../app.js';
import { registerThaitern as registerRoutes } from './routes.js';

export function registerThaitern(app: FastifyInstance, deps: Deps) {
  registerRoutes(app, deps);
}
