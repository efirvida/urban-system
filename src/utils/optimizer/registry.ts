/**
 * Optimizer registry — public surface for the registry.
 *
 * Mirrors `src/utils/routing/service.ts` (which chains `RouteProvider`s
 * for the matrix build). The route layer calls `runAll(params)` and
 * gets back a fixed-order array of `(OptimizerResult | null)` slots —
 * one per registered optimizer. Thrown errors land as `null` so a
 * single misbehaving optimizer never poisons the response.
 *
 * Registration order is meaningful: the UI renders tabs in this order
 * and the "best result" tiebreak falls back to it when distance and
 * day count are tied.
 */

import type { Optimizer, OptimizeParams, OptimizerResult } from './types';

export class OptimizerRegistry {
  private readonly optimizers: Optimizer[];

  constructor(optimizers: Optimizer[]) {
    // Defensive copy so callers can mutate their own array freely.
    this.optimizers = [...optimizers];
  }

  /** List the registered optimizers in registration order. */
  list(): readonly Optimizer[] {
    return this.optimizers;
  }

  /**
   * Invoke every optimizer in parallel. Returns a fixed-length array
   * aligned to `this.optimizers` — each slot is either the optimizer's
   * `OptimizerResult` or `null` if it failed or is unavailable.
   *
   * Errors are caught via `Promise.allSettled` and surface as `null`
   * slots; the request itself always returns 200.
   */
  async runAll(params: OptimizeParams): Promise<(OptimizerResult | null)[]> {
    const settled = await Promise.allSettled(this.optimizers.map((o) => o.optimize(params)));
    return settled.map((r) => (r.status === 'fulfilled' ? r.value : null));
  }
}
