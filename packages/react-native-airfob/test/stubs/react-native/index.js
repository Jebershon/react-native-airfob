/**
 * Minimal React Native stub for the zero-dependency smoke test.
 *
 * NativeModules is deliberately empty: that is the mock-fallback path, and the
 * one every Mendix developer hits in Make It Native.
 */
export const NativeModules = {};

export const Platform = { OS: "test" };

export class NativeEventEmitter {
  addListener() {
    return { remove() {} };
  }
}
