import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../app.js';
import { registerTeacher } from './teacher.js';
import { registerStudent } from './student.js';

export function registerIdeax(app: FastifyInstance, deps: Deps) {
  registerTeacher(app, deps);
  registerStudent(app, deps);
}
