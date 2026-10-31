import { z } from 'zod';

const envSchema = z.object({
  SAGE_CLIENT_ID: z.string().default(''),
  SAGE_CLIENT_SECRET: z.string().default(''),
  SAGE_SUBSCRIPTION_KEY: z.string().default(''),
  SAGE_REDIRECT_URI: z.string().default('http://localhost:3000/auth/sage/callback'),
  SAGE_AUTH_URL: z.string().default('https://www.sageone.com/oauth2/auth/central?filter=apiv3.1'),
  SAGE_TOKEN_URL: z.string().default('https://oauth.accounting.sage.com/token'),
  SAGE_API_BASE: z.string().default('https://api.accounting.sage.com/v3.1'),
  SAGE_SCOPE: z.string().default('full_access'),
  PORT: z.coerce.number().default(3000),
  SYNC_MONTHS_BACK: z.coerce.number().default(12),
  TOKEN_STORE_PATH: z.string().default('.data/tokens.json'),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return envSchema.parse(env);
}
