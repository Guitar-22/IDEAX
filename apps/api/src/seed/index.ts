import type { Deps } from '../app.js';
import { seedFoundation } from './foundation.js';
import { seedIdeaxCatalog, seedIdeaxSubmissions } from './ideax.js';

export async function seedAll(deps: Deps) {
  await seedFoundation(deps.db);
  await seedIdeaxCatalog(deps);
  await seedIdeaxSubmissions(deps);
}
