import type { Deps } from './app.js';
import { registerIdeaxJobs } from './modules/ideax/jobs.js';
import { registerThaiternJobs } from './modules/thaitern/jobs.js';

/** Registers background job handlers on the queue. */
export function registerJobs(deps: Deps) {
  registerIdeaxJobs(deps);
  registerThaiternJobs(deps);
}
