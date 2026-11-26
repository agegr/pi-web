/**
 * Whether pi's `PI_OFFLINE` is set, for every network request pi-web makes on
 * its own (model catalog refresh, plugin update checks, the Pi Web update check).
 *
 * pi reads the variable more than one way: its CLI and package manager take
 * only `1`, `true` or `yes`, while the SDK's `ModelRuntime`, which runs inside
 * pi-web's process, takes any value, empty included, as "never touch the
 * network". pi-web follows the runtime, so no request of pi-web's goes out
 * while the SDK in the same process stays offline.
 */
export function isPiOffline(): boolean {
  return process.env.PI_OFFLINE !== undefined;
}
