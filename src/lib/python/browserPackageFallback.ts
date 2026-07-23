export const CLOUD_PLAYGROUND_HANDOFF_KEY = 'pathwise-cloud-playground-code'

export function isBrowserPackageIncompatibility(message: string): boolean {
  return /(?:pure Python 3 wheel|compatible wheel.*Pyodide|not supported in Pyodide)/i
    .test(message)
}
