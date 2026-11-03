import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { envSchema } from './env-schema.js';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

export const env = envSchema.parse(process.env);
