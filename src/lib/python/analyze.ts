// Lightweight heuristics over user code. Used to warn — before they hit a
// confusing error — when a snippet needs network/API access that in-browser
// Python (Pyodide) can't provide (external APIs block browser calls via CORS,
// and an API key in the browser is unsafe).

const NETWORK_PATTERNS: RegExp[] = [
  /\b(?:import|from)\s+(?:openai|anthropic|requests|httpx|aiohttp|urllib|http\.client|socket|boto3|cohere|google\.generativeai)\b/,
  /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|api_key)\b/,
  /\.(?:chat\.completions|messages|embeddings|responses)\.(?:create|stream)\b/,
]

/** True when code appears to call an external/network API that won't run in-browser. */
export function codeNeedsNetwork(code: string): boolean {
  return NETWORK_PATTERNS.some((re) => re.test(code))
}
