import { Db, MongoClient } from "mongodb";

import type { Plan } from "@/lib/auth/types";

import type {
  MongoOwnerDocument,
  MongoPortfolioItem,
  OwnerType,
  OwnerWithPortfolio,
  PortfolioStock,
} from "@/types";

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  throw new Error("MONGODB_URI environment variable is not set");
}
const MONGODB_URI: string = mongoUri;

const VALID_OWNER_TYPES: readonly OwnerType[] = [
  "ID",
  "CP",
  "IB",
  "IS",
  "SC",
  "PF",
  "MF",
  "YD",
  "GY",
  "BK",
  "OT",
];

function toOwnerType(value: unknown): OwnerType {
  return VALID_OWNER_TYPES.includes(value as OwnerType)
    ? (value as OwnerType)
    : "OT";
}
const DB_NAME = "right_to_information";

let client: MongoClient | null = null;
let db: Db | null = null;

/**
 * Connect to MongoDB
 */
export async function connectDB(): Promise<Db> {
  if (db) return db;

  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    return db;
  } catch (error) {
    throw error;
  }
}

/**
 * Get MongoDB database instance
 */
export async function getDB(): Promise<Db> {
  if (db) return db;
  return connectDB();
}

/**
 * Close MongoDB connection
 */
export async function closeDB(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

/**
 * Database queries for stocks
 */
export const stockQueries = {
  async findAll(limit = 10000) {
    const database = await getDB();
    return database.collection("stocks").find({}).limit(limit).toArray();
  },

  async find(
    filter: Record<string, unknown>,
    options: {
      limit?: number;
      skip?: number;
      sort?: Record<string, 1 | -1>;
    } = {},
  ) {
    const database = await getDB();
    const { limit = 50, skip = 0, sort } = options;
    let cursor = database
      .collection("stocks")
      .find(filter)
      .skip(skip)
      .limit(Math.min(limit, 10000));
    if (sort && Object.keys(sort).length > 0) {
      cursor = cursor.sort(sort);
    }
    return cursor.toArray();
  },

  async findByCode(code: string) {
    const database = await getDB();
    const stock = await database.collection("stocks").findOne({ code });
    if (stock) {
      const holdings = await database
        .collection("ownershipHoldings")
        .find({ stockCode: code })
        .toArray();
      return { ...stock, holdings };
    }
    return null;
  },

  async count(filter: Record<string, unknown> = {}) {
    const database = await getDB();
    return database.collection("stocks").countDocuments(filter);
  },
};

/**
 * Database queries for owners
 */
export const ownerQueries = {
  async find(
    filter: Record<string, unknown>,
    options: { limit?: number; skip?: number } = {},
  ) {
    const database = await getDB();
    const { limit = 50, skip = 0 } = options;
    return database
      .collection("owners")
      .find(filter)
      .skip(skip)
      .limit(Math.min(limit, 1000))
      .toArray();
  },

  async getTop(limit = 100) {
    const database = await getDB();
    return database
      .collection("owners")
      .aggregate([
        { $group: { _id: "$name", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ])
      .toArray();
  },

  async getTopWithPortfolio(limit = 100): Promise<OwnerWithPortfolio[]> {
    const database = await getDB();
    const owners = (await database
      .collection<MongoOwnerDocument>("owners")
      .find({})
      .sort({ "stats.totalHoldings": -1 })
      .limit(limit)
      .toArray()) as MongoOwnerDocument[];

    if (owners.length === 0) return [];

    const stockCodes = new Set<string>();
    for (const o of owners) {
      for (const p of o.portfolio ?? []) {
        stockCodes.add(p.stockCode);
      }
    }

    const stocks = await database
      .collection<{ code: string; issuer?: string }>("stocks")
      .find({ code: { $in: Array.from(stockCodes) } })
      .project({ code: 1, issuer: 1 })
      .toArray();

    const stockMap = new Map(stocks.map((s) => [s.code, s.issuer ?? ""]));

    return owners.map((o): OwnerWithPortfolio => {
      const portfolio = o.portfolio ?? [];
      const portfolioStocks: PortfolioStock[] = portfolio.map(
        (p: MongoPortfolioItem) => ({
          code: p.stockCode,
          pct: p.percentage ?? 0,
          issuer: stockMap.get(p.stockCode) ?? "",
        }),
      );
      return {
        name: o.name,
        type: toOwnerType(o.type),
        count: portfolio.length,
        totalPct: o.stats?.totalConcentration ?? 0,
        stocks: portfolioStocks,
      };
    });
  },
};

/**
 * Database queries for users (plan storage)
 */
export const userQueries = {
  async findById(id: string): Promise<{ plan: Plan; isAdmin?: boolean } | null> {
    const database = await getDB();
    const user = await database
      .collection("users")
      .findOne({ userId: id }, { projection: { plan: 1, isAdmin: 1 } });
    return user
      ? {
          plan: (user.plan as Plan) ?? "free",
          isAdmin: !!user.isAdmin,
        }
      : null;
  },

  async upsertUser(
    id: string,
    email: string | null,
    name: string | null,
    image: string | null,
  ): Promise<void> {
    const database = await getDB();
    const now = new Date();
    await database.collection("users").updateOne(
      { userId: id },
      {
        $set: { email, name, image, updatedAt: now },
        $setOnInsert: { userId: id, plan: "free" as Plan },
      },
      { upsert: true },
    );
  },

  async updatePlan(userId: string, plan: "free" | "premium"): Promise<void> {
    const database = await getDB();
    await database
      .collection("users")
      .updateOne({ userId }, { $set: { plan, updatedAt: new Date() } });
  },
};

/**
 * Database queries for analytics
 */
export const analyticsQueries = {
  async getStats(filter: Record<string, unknown> = {}) {
    const database = await getDB();
    const stocks = (await database
      .collection("stocks")
      .find(filter)
      .toArray()) as {
      tier?: string;
      hhi?: number;
      floatPercentage?: number;
    }[];

    const totalStocks = stocks.length;
    return {
      totalStocks,
      byTier: {
        red: stocks.filter((s) => s.tier === "Red").length,
        amber: stocks.filter((s) => s.tier === "Amber").length,
        green: stocks.filter((s) => s.tier === "Green").length,
      },
      avgHHI:
        totalStocks > 0
          ? stocks.reduce((sum, s) => sum + (s.hhi ?? 0), 0) / totalStocks
          : 0,
      avgFloat:
        totalStocks > 0
          ? stocks.reduce((sum, s) => sum + (s.floatPercentage ?? 0), 0) /
            totalStocks
          : 0,
    };
  },
};
