
import { z } from "zod";

const dateSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  "Date must use YYYY-MM-DD",
).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime())
    && date.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");

const partySchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(1000),
  gstin: z.string().regex(
    /^[0-9A-Z]{15}$/,
    "GSTIN must contain 15 uppercase letters or digits",
  ).optional(),
}).strict();

const lineItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().max(1_000_000)
    .refine((value) => Number.isInteger(value * 1000),
      "Quantity supports at most three decimal places"),
  unitPricePaise: z.number().int().nonnegative().max(10_000_000_000),
  gstRateBps: z.number().int().min(0).max(2800),
}).strict();

const baseDocumentSchema = z.object({
  documentId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  issueDate: dateSchema,
  seller: partySchema,
  buyer: partySchema,
  lineItems: z.array(lineItemSchema).min(1).max(1000),
  notes: z.string().max(2000).optional(),
}).strict();

export const documentSchema = z.discriminatedUnion("documentType", [
  baseDocumentSchema.extend({
    documentType: z.literal("purchase_order"),
    expectedDeliveryDate: dateSchema.optional(),
  }),
  baseDocumentSchema.extend({
    documentType: z.literal("invoice"),
    dueDate: dateSchema.optional(),
  }),
]);

export type DocumentPayload = z.infer<typeof documentSchema>;
