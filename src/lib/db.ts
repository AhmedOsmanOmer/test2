import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: InstanceType<typeof PrismaClient> };

function create() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? create();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type DB = typeof db;
/** عميل المعاملة داخل db.$transaction */
export type Tx = Parameters<Parameters<DB["$transaction"]>[0]>[0];
