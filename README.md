# Later Together

An experimental expedition game about specifying boundaries for an absent companion. A policy capsule defines budgets, goals, and how to react to situations; the simulation logs actions and pauses for decisions.

## Run

Requires Node.js 22 or newer. Set `NEBIUS_API_KEY` for optional model-assisted capsule drafting; keep the key out of source. Run `npm start`, and open the local address printed by the server. Run `npm test` for checks.

## Status and limitations

Work in progress: 17 of 19 automated tests passed in the latest local run. Two engine tests concerning budget accounting and wait behavior failed; do not rely on these behaviors as verified. The model adapter was tested with a simulated response, and a real provider call has not yet been independently verified.

MIT licensed; see LICENSE.
