export function resolveAllowedOrigin(origin: string | undefined, allowedExtensionId = process.env.ALLOWED_EXTENSION_ID): string | undefined {
  if (!origin?.startsWith('chrome-extension://')) return undefined;
  if (allowedExtensionId && origin !== `chrome-extension://${allowedExtensionId}`) return undefined;
  return origin;
}
