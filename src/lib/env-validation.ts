const REQUIRED_ENV_VARS = ['DATABASE_URL'] as const

const OPTIONAL_ENV_VARS = [
  'MIMO_API_KEY',
  'MIMO_BASE_URL',
  'MIMO_MODEL',
  'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY',
] as const

export function validateEnv(): { ok: boolean; missing: string[]; warnings: string[] } {
  const missing: string[] = []
  const warnings: string[] = []

  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      missing.push(key)
    }
  }

  for (const key of OPTIONAL_ENV_VARS) {
    if (!process.env[key]) {
      warnings.push(key)
    }
  }

  if (missing.length > 0) {
    console.error(`[env] Missing required env vars: ${missing.join(', ')}`)
  }

  if (warnings.length > 0) {
    console.warn(`[env] Optional env vars not set: ${warnings.join(', ')}`)
  }

  return { ok: missing.length === 0, missing, warnings }
}
