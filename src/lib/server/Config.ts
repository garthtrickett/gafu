const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const getEnvOptional = (key: string): string | undefined => {
  return process.env[key];
};

export const config = {
  db: {
    url: getEnv("DATABASE_URL"),
    localUrl: getEnvOptional("DATABASE_URL_LOCAL"),
    useLocalProxy: process.env.USE_LOCAL_NEON_PROXY === "true",
  },
  s3: {
    bucketName: getEnv("BUCKET_NAME"),
    publicAvatarUrl: getEnv("PUBLIC_AVATAR_URL"),
    endpointUrl: getEnv("AWS_ENDPOINT_URL_S3"),
    accessKeyId: getEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: getEnv("AWS_SECRET_ACCESS_KEY"),
    region: getEnv("AWS_REGION"),
    forcePathStyle: process.env.AWS_FORCE_PATH_STYLE === "true",
  },
  app: {
    nodeEnv: process.env.NODE_ENV || "development",
    isProduction: process.env.NODE_ENV === "production",
    rootDomain: process.env.ROOT_DOMAIN || "life-io.xyz",
  },
  jwt: {
    secret: getEnv("JWT_SECRET"),
  },
};
