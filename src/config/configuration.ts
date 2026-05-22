type DbType = 'postgresql' | 'mysql';

const defaultDbPort: Record<DbType, number> = {
  postgresql: 5432,
  mysql: 3306,
};

const defaultDbCharset: Record<DbType, string> = {
  postgresql: 'UTF8',
  mysql: 'utf8mb4',
};

export default () => {
  const dbType = (process.env.DB_TYPE ?? 'postgresql') as DbType;

  return {
    port: parseInt(process.env.PORT ?? '8789', 10),
    nodeEnv: process.env.NODE_ENV ?? 'development',

    client: {
      id: process.env.CLIENT_ID ?? '',
      secretKey: process.env.SECRET_KEY ?? '',
    },

    database: {
      type: dbType,
      host: process.env.DB_HOST ?? 'localhost',
      port: parseInt(process.env.DB_PORT ?? String(defaultDbPort[dbType]), 10),
      username: process.env.DB_USERNAME ?? 'postgres',
      password: process.env.DB_PASSWORD ?? '',
      name: process.env.DB_NAME ?? 'psych_net',
      charset: process.env.DB_CHARSET ?? defaultDbCharset[dbType],
    },

    schedule: parseInt(process.env.SET_SCHEDULE ?? '60', 10),

    jwt: {
      secret: process.env.JWT_SECRET ?? 'secret',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    },
  };
};
