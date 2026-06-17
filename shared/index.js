// shared/index.js
// Public barrel for the canonical model. The agent, bridge, and dashboard all
// import from here — never from shared/enums.js or shared/canonical.js
// directly — so this file is the actual contract surface of /shared.

export * from './enums.js';
export * from './canonical.js';
export * from './validate.js';
