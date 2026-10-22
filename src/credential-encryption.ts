import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CredentialEncryption } from '@siwc/local';

/**
 * Criptografia dos tokens em repouso: AES-256-GCM com uma chave aleatória guardada em arquivo
 * com permissão 0600, separado do arquivo de credenciais. Protege contra cópia/backup acidental
 * do arquivo de tokens, mas não contra outro processo do mesmo usuário (não há keyring do SO).
 */
export function createFileKeyEncryption(keyFile: string): CredentialEncryption {
  const loadKey = (): Buffer => {
    if (existsSync(keyFile)) return Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64');
    const key = randomBytes(32);
    mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 });
    writeFileSync(keyFile, key.toString('base64'), { mode: 0o600 });
    chmodSync(keyFile, 0o600);
    return key;
  };
  return {
    id: 'file-key-aes-256-gcm-v1',
    isAvailable: () => true,
    encrypt(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', loadKey(), iv);
      const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decrypt(ciphertext) {
      const buffer = Buffer.from(ciphertext);
      const decipher = createDecipheriv('aes-256-gcm', loadKey(), buffer.subarray(0, 12));
      decipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}
