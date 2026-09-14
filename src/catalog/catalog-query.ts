import { z } from "zod";
export const catalogQuery = z.object({
  dataMode: z.enum(["BUSINESS", "TEST", "ALL"]).default("BUSINESS"),
  brandId: z.string().uuid().optional(),
  conditionId: z.string().uuid().optional(),
  colorId: z.string().uuid().optional(),
  materialId: z.string().uuid().optional(),
  q: z.string().max(150).default(""),
  status: z
    .enum([
      "",
      "AVAILABLE",
      "PAUSED",
      "RESERVED",
      "SOLD",
      "SUPPLIER_SOLD",
      "GIFTED",
      "SELF_USE",
      "QUARANTINED",
    ])
    .default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  size: z.coerce
    .number()
    .refine((n) => [30, 60, 100].includes(n), "每页只能为30、60或100件")
    .default(30),
  category: z
    .enum(["", "CLOTHING", "BAG", "SHOES", "ACCESSORY", "OTHER"])
    .default(""),
  ownership: z.enum(["", "OWN", "SUPPLIER"]).default(""),
  review: z.enum(["", "pending", "approved"]).default(""),
  listing: z.enum(["", "none", "recorded"]).default(""),
  sort: z.enum(["newest", "oldest", "updated"]).default("newest"),
});
export type CatalogFilters = Partial<
  Pick<
    z.infer<typeof catalogQuery>,
    | "dataMode"
    | "size"
    | "category"
    | "ownership"
    | "review"
    | "listing"
    | "sort"
    | "brandId"
    | "conditionId"
    | "colorId"
    | "materialId"
  >
>;
