import { createHash, randomBytes } from 'node:crypto';

export function newSecret() { return randomBytes(32).toString('base64url'); }
export function hashSecret(value) { return createHash('sha256').update(value).digest('hex'); }
