// Global APIs injected at runtime by Office.js / custom-functions-runtime

declare namespace CustomFunctions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function associate(id: string, handler: (...args: any[]) => unknown): void;
}
