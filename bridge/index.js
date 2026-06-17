// bridge/index.js
// Public barrel for the bridge service: the five-method API the agent and
// dashboard call (api.js) plus the poller's start/stop/tick controls. Running
// this file directly (`npm run bridge`) starts the outbox poller process.

export { publish, update, unpublish, getStatus, uploadMedia } from './api.js';
export { startPoller, stopPoller, tick } from './poller.js';

import { fileURLToPath } from 'node:url';
import { startPoller } from './poller.js';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('[bridge] starting outbox poller...');
  startPoller();
}
