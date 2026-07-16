export function isEphemeralRuntime(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME);
}
