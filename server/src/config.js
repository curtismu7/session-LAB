// Deployment configuration: the MODE switch (rule 18). One image serves the local standalone and the hosted SE build.
// Only MODE=mock exists. A live mode is not implemented, so asking for one is an error, never a silent fallback.
export function modeFrom(env = { MODE: process.env.MODE }) {
  const m = env.MODE === undefined || env.MODE === '' ? 'mock' : env.MODE;
  if (m !== 'mock') throw new Error(`MODE=${String(m).slice(0, 20)} is not available: this app has a mock mode only`);
  return m;
}

// SESSIONLAB_HOSTED=1 marks the SE build: the banner says HOSTED SIMULATION. It changes wording only, never behaviour.
export const hostedFrom = (env = process.env) => env.SESSIONLAB_HOSTED === '1';
