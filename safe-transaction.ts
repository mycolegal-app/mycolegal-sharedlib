// @mycolegal-app/sharedlib/safe-transaction — transacción Prisma con retry
// automático (bloque byte-idéntico extraído de las apps que generan números
// secuenciales o requieren aislamiento Serializable).
//
// Usa el singleton `prisma` de @mycolegal-app/sharedlib/db (la misma instancia
// que la app re-exporta como `@/lib/db`). `@prisma/client` es peerDependency
// OPCIONAL: en runtime resuelve al cliente generado por la app consumidora.

import { Prisma } from '@prisma/client';
import { prisma } from './db';

type TransactionClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type TransactionFn<T> = (tx: TransactionClient) => Promise<T>;

interface SafeTransactionOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  maxRetries?: number;
}

/**
 * Runs a Prisma interactive transaction with automatic retry on serialization
 * failures (P2034) and unique constraint violations (P2002).
 *
 * Use this for operations that generate sequential numbers or need
 * Serializable isolation to prevent TOCTOU races.
 */
export async function safeTransaction<T>(
  fn: TransactionFn<T>,
  options: SafeTransactionOptions = {},
): Promise<T> {
  const { isolationLevel = 'Serializable', maxRetries = 3 } = options;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel });
    } catch (error: any) {
      const retryable =
        error?.code === 'P2034' || // serialization failure
        error?.code === 'P2002';   // unique constraint (sequence collision)

      if (!retryable || attempt === maxRetries - 1) throw error;

      // Exponential backoff: 50ms, 100ms, 200ms
      await new Promise((r) => setTimeout(r, 50 * Math.pow(2, attempt)));
    }
  }
  throw new Error('safeTransaction: max retries exhausted');
}
