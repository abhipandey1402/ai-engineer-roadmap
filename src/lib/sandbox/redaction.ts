function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function redactSecrets(text: string, secrets: string[]): string {
  const candidates = [...new Set(secrets)]
    .filter((secret) => secret.length >= 8)
    .sort((left, right) => right.length - left.length)

  if (candidates.length === 0) return text

  const pattern = candidates.map(escapeRegularExpression).join('|')
  return text.replace(new RegExp(pattern, 'g'), '[REDACTED]')
}
