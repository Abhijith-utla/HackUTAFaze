// @faze/shared (lead-owned) exports zod schemas but not these inferred types; derive them here.
import type { z } from "zod";
import type { PacksResponse as P, CollectionResponse as C } from "@faze/shared";
export type PacksResponse = z.infer<typeof P>;
export type CollectionResponse = z.infer<typeof C>;
