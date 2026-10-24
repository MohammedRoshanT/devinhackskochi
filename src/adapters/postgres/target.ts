import { z } from "zod";

const identifier = z.string().regex(/^[a-z_][a-z0-9_]{0,62}$/, "Use a lowercase, unquoted PostgreSQL identifier.");
const setting = z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/, "Use a two-part custom setting name such as app.current_user_id.");

export const postgresTargetSchema = z.object({
  database: identifier,
  ownerRole: identifier,
  appRole: identifier,
  identitySetting: setting,
  identityFunction: setting,
  resourceTypes: z.record(z.string(), z.object({
    schema: identifier,
    table: identifier,
    idColumn: identifier,
    ownerColumn: identifier,
    actions: z.record(z.string(), z.discriminatedUnion("operation", [
      z.object({ operation: z.literal("select") }).strict(),
      z.object({ operation: z.literal("update"), column: identifier }).strict(),
    ])),
  }).strict()),
}).strict();

export type PostgresTarget = z.infer<typeof postgresTargetSchema>;
export type TableMapping = PostgresTarget["resourceTypes"][string];

export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
export const qualified = (mapping: TableMapping) => `${quoteIdent(mapping.schema)}.${quoteIdent(mapping.table)}`;
