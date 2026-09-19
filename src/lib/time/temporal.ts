import { Temporal as TemporalPolyfill } from "@js-temporal/polyfill"

/**
 * Clock changes come from the IANA timezone database, not a time HTTP API.
 * Chrome and Firefox ship that database inside Temporal and update it with
 * the browser. Other browsers use the same data from the Temporal polyfill,
 * which is refreshed when this dependency is updated. A live "current time"
 * API cannot describe a future day's missing or repeated hour.
 */
const nativeTemporal = (
  globalThis as { Temporal?: typeof TemporalPolyfill }
).Temporal

export const Temporal: typeof TemporalPolyfill = nativeTemporal ?? TemporalPolyfill
