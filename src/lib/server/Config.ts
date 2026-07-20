const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const getEnvOrDefault = (key: string, defaultValue: string): string => {
  return process.env[key] || defaultValue;
};

const getPositiveIntegerEnv = (
  key: string,
  defaultValue: number,
): number => {
  const rawValue = process.env[key]?.trim();
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `Environment variable ${key} must be a positive integer.`,
    );
  }

  return parsed;
};

const getNonNegativeIntegerEnv = (
  key: string,
  defaultValue: number,
): number => {
  const rawValue = process.env[key]?.trim();
  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(
      `Environment variable ${key} must be a non-negative integer.`,
    );
  }

  return parsed;
};

const legacyPublicMediaUrl = getEnvOrDefault(
  "PUBLIC_AVATAR_URL",
  "http://localhost:9000/life-io",
);

export const config = {
  db: {
    url: getEnv("DATABASE_URL"),
  },
  s3: {
    bucketName: getEnvOrDefault("BUCKET_NAME", "life-io"),
    publicAvatarUrl: legacyPublicMediaUrl,
    publicTtsUrl: getEnvOrDefault(
      "PUBLIC_TTS_BASE_URL",
      legacyPublicMediaUrl,
    ),
    endpointUrl: getEnvOrDefault(
      "AWS_ENDPOINT_URL_S3",
      "http://localhost:9000",
    ),
    accessKeyId: getEnvOrDefault(
      "AWS_ACCESS_KEY_ID",
      "minioadmin",
    ),
    secretAccessKey: getEnvOrDefault(
      "AWS_SECRET_ACCESS_KEY",
      "minioadmin",
    ),
    region: getEnvOrDefault("AWS_REGION", "us-east-1"),
    forcePathStyle:
      process.env.AWS_FORCE_PATH_STYLE === "true" ||
      process.env.AWS_FORCE_PATH_STYLE === undefined,
  },
  tts: {
    staticCardProvider: getEnvOrDefault(
      "STATIC_CARD_AUDIO_PROVIDER",
      "google",
    ),
    maxItemsPerImport: getPositiveIntegerEnv(
      "TTS_MAX_ITEMS_PER_IMPORT",
      100,
    ),
    dailySynthesisLimit: getPositiveIntegerEnv(
      "TTS_DAILY_SYNTHESIS_LIMIT",
      200,
    ),
    concurrencyLimit: getPositiveIntegerEnv(
      "TTS_CONCURRENCY_LIMIT",
      3,
    ),
    maxTransientRetries: getNonNegativeIntegerEnv(
      "TTS_MAX_TRANSIENT_RETRIES",
      2,
    ),
    retryBaseDelayMs: getNonNegativeIntegerEnv(
      "TTS_RETRY_BASE_DELAY_MS",
      250,
    ),
  },
  app: {
    nodeEnv: process.env.NODE_ENV || "development",
    isProduction: process.env.NODE_ENV === "production",
    rootDomain: process.env.ROOT_DOMAIN || "life-io.xyz",
  },
  jwt: {
    secret: getEnvOrDefault(
      "JWT_SECRET",
      "Few4D1oru8s1GEZJY2mmg1hjdC2nszByiLuUba1bcbA=",
    ),
  },
};
