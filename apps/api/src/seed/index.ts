import type { Deps } from '../app.js';
import { seedFoundation } from './foundation.js';

export async function seedAll(deps: Deps) {
  await seedFoundation(deps.db);
}
