export const findForbiddenClientCredentialKeys = (
  environment: Readonly<Record<string, string | undefined>>,
): readonly string[] =>
  Object.entries(environment)
    .filter(([key, value]) => {
      if (!key.startsWith("VITE_") || !value?.trim()) {
        return false;
      }

      return (
        /GOOGLE.*(?:CREDENTIAL|PRIVATE_KEY|CLIENT_SECRET)/iu.test(key) ||
        /AWS.*(?:ACCESS_KEY|SECRET|SESSION_TOKEN)/iu.test(key) ||
        /(?:TTS|VAPI).*(?:API_KEY|SECRET|TOKEN)/iu.test(key)
      );
    })
    .map(([key]) => key)
    .sort();

export const assertNoClientCredentialEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  const forbiddenKeys =
    findForbiddenClientCredentialKeys(environment);

  if (forbiddenKeys.length === 0) {
    return;
  }

  throw new Error(
    `Server credentials must not use VITE_ variables. Remove: ${forbiddenKeys.join(", ")}.`,
  );
};
