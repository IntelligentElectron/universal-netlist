/**
 * Altium Parser - Zod Validation Schemas
 *
 * Schemas for validating Altium schematic records and their conversion
 * to the ParsedNetlist format.
 */

import { z } from 'zod';
import { RECORD_TYPES } from './types.js';

// =============================================================================
// Base Record Schemas
// =============================================================================

/**
 * Base schema for all Altium records
 */
export const AltiumRecordBaseSchema = z.object({
  index: z.number().int().nonnegative(),
  RECORD: z.string().optional(),
  OwnerIndex: z.string().optional(),
  OwnerPartId: z.string().optional(),
});

/**
 * Location coordinates schema
 */
export const LocationSchema = z.object({
  'Location.X': z.union([z.string(), z.number()]).optional(),
  'Location.Y': z.union([z.string(), z.number()]).optional(),
});

/**
 * Corner coordinates schema (for rectangles, etc.)
 */
export const CornerSchema = z.object({
  'Corner.X': z.union([z.string(), z.number()]).optional(),
  'Corner.Y': z.union([z.string(), z.number()]).optional(),
});

// =============================================================================
// Specific Record Type Schemas
// =============================================================================

/**
 * Component record (RECORD=1)
 */
export const ComponentRecordSchema = AltiumRecordBaseSchema.extend({
  RECORD: z.literal(RECORD_TYPES.COMPONENT),
  LibReference: z.string().optional(),
  ComponentDescription: z.string().optional(),
  DesignItemId: z.string().optional(),
  PartCount: z.union([z.string(), z.number()]).optional(),
  CurrentPartId: z.union([z.string(), z.number()]).optional(),
  UniqueID: z.string().optional(),
  // Vault fields
  VaultGUID: z.string().optional(),
  ItemGUID: z.string().optional(),
  RevisionGUID: z.string().optional(),
}).passthrough();

/**
 * Pin record (RECORD=2)
 */
export const PinRecordSchema = AltiumRecordBaseSchema.extend({
  RECORD: z.literal(RECORD_TYPES.PIN),
  Name: z.string().optional(),
  Designator: z.union([z.string(), z.number()]).optional(),
  Description: z.string().optional(),
  Electrical: z.string().optional(),
  PinLength: z.union([z.string(), z.number()]).optional(),
  PinConglomerate: z.union([z.string(), z.number()]).optional(),
})
  .merge(LocationSchema)
  .passthrough();

/**
 * Designator record (RECORD=34)
 */
export const DesignatorRecordSchema = AltiumRecordBaseSchema.extend({
  RECORD: z.literal(RECORD_TYPES.DESIGNATOR),
  Name: z.literal('Designator').optional(),
  Text: z.string(),
  FontID: z.union([z.string(), z.number()]).optional(),
  Color: z.union([z.string(), z.number()]).optional(),
})
  .merge(LocationSchema)
  .passthrough();

/**
 * Parameter record (RECORD=41)
 */
export const ParameterRecordSchema = AltiumRecordBaseSchema.extend({
  RECORD: z.literal(RECORD_TYPES.PARAMETER),
  Name: z.string(),
  Text: z.string().optional(),
  IsHidden: z.string().optional(),
  FontID: z.union([z.string(), z.number()]).optional(),
  Color: z.union([z.string(), z.number()]).optional(),
})
  .merge(LocationSchema)
  .passthrough();

/**
 * Wire record (RECORD=27)
 */
export const WireRecordSchema = AltiumRecordBaseSchema.extend({
  RECORD: z.literal(RECORD_TYPES.WIRE),
  LocationCount: z.union([z.string(), z.number()]).optional(),
  LineWidth: z.union([z.string(), z.number()]).optional(),
  Color: z.union([z.string(), z.number()]).optional(),
  UniqueID: z.string().optional(),
  // Wire coordinates are X1,Y1,X2,Y2,... patterns
}).passthrough();

/**
 * Power port record (RECORD=17)
 */
export const PowerPortRecordSchema = AltiumRecordBaseSchema.extend({
  RECORD: z.literal(RECORD_TYPES.POWER_PORT),
  Text: z.string(),
  Style: z.string().optional(),
  Orientation: z.union([z.string(), z.number()]).optional(),
  ShowNetName: z.string().optional(),
  FontID: z.union([z.string(), z.number()]).optional(),
  Color: z.union([z.string(), z.number()]).optional(),
})
  .merge(LocationSchema)
  .passthrough();

/**
 * Net label record (RECORD=25)
 */
export const NetLabelRecordSchema = AltiumRecordBaseSchema.extend({
  RECORD: z.literal(RECORD_TYPES.NET_LABEL),
  Text: z.string(),
  Justification: z.union([z.string(), z.number()]).optional(),
  FontID: z.union([z.string(), z.number()]).optional(),
  Color: z.union([z.string(), z.number()]).optional(),
})
  .merge(LocationSchema)
  .passthrough();

/**
 * Junction record (RECORD=29)
 */
export const JunctionRecordSchema = AltiumRecordBaseSchema.extend({
  RECORD: z.literal(RECORD_TYPES.JUNCTION),
  Color: z.union([z.string(), z.number()]).optional(),
})
  .merge(LocationSchema)
  .passthrough();

/**
 * Sheet record (RECORD=31) - document settings
 */
export const SheetRecordSchema = AltiumRecordBaseSchema.extend({
  RECORD: z.literal(RECORD_TYPES.SHEET),
  FontIdCount: z.union([z.string(), z.number()]).optional(),
  SheetStyle: z.union([z.string(), z.number()]).optional(),
  AreaColor: z.union([z.string(), z.number()]).optional(),
  SnapGridSize: z.union([z.string(), z.number()]).optional(),
  VisibleGridSize: z.union([z.string(), z.number()]).optional(),
  CustomX: z.union([z.string(), z.number()]).optional(),
  CustomY: z.union([z.string(), z.number()]).optional(),
}).passthrough();

/**
 * Implementation record (RECORD=45) - footprint/model
 */
export const ImplementationRecordSchema = AltiumRecordBaseSchema.extend({
  RECORD: z.literal(RECORD_TYPES.IMPLEMENTATION),
  Description: z.string().optional(),
  ModelName: z.string().optional(),
  ModelType: z.string().optional(),
  IsCurrent: z.string().optional(),
}).passthrough();

// =============================================================================
// Schematic Structure Schemas
// =============================================================================

/**
 * Altium schematic structure
 */
export const AltiumSchematicSchema = z.object({
  header: z.array(AltiumRecordBaseSchema.passthrough()),
  records: z.array(AltiumRecordBaseSchema.passthrough()),
});

/**
 * Net structure
 */
export const AltiumNetSchema = z.object({
  name: z.string().nullable(),
  devices: z.array(AltiumRecordBaseSchema.passthrough()),
});

// =============================================================================
// Conversion Output Schemas (ParsedNetlist format)
// =============================================================================

/**
 * Component detail in ParsedNetlist format
 */
const PinEntrySchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    net: z.string(),
  }),
]);

export const ParsedComponentSchema = z.object({
  mpn: z.string().optional(),
  description: z.string().optional(),
  comment: z.string().optional(),
  partName: z.string().optional(),
  pins: z.record(z.string(), PinEntrySchema),
});

/**
 * Net connections in ParsedNetlist format
 * Map of net name -> { refdes -> [pin numbers] }
 */
export const ParsedNetConnectionsSchema = z.record(
  z.string(),
  z.record(z.string(), z.array(z.string()))
);

/**
 * Complete ParsedNetlist structure
 */
export const ParsedNetlistSchema = z.object({
  nets: ParsedNetConnectionsSchema,
  components: z.record(z.string(), ParsedComponentSchema),
  chips: z.array(z.unknown()),
});

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate a component record.
 */
export const validateComponentRecord = (record: unknown): boolean => {
  return ComponentRecordSchema.safeParse(record).success;
};

/**
 * Validate a pin record.
 */
export const validatePinRecord = (record: unknown): boolean => {
  return PinRecordSchema.safeParse(record).success;
};

/**
 * Validate a parameter record.
 */
export const validateParameterRecord = (record: unknown): boolean => {
  return ParameterRecordSchema.safeParse(record).success;
};

/**
 * Validate the final ParsedNetlist output.
 */
export const validateParsedNetlist = (netlist: unknown): z.infer<typeof ParsedNetlistSchema> => {
  return ParsedNetlistSchema.parse(netlist);
};

/**
 * Safe validation that returns null on failure.
 */
export const safeParsedNetlist = (netlist: unknown): z.infer<typeof ParsedNetlistSchema> | null => {
  const result = ParsedNetlistSchema.safeParse(netlist);
  return result.success ? result.data : null;
};

// =============================================================================
// Type Exports (inferred from schemas)
// =============================================================================

export type ComponentRecord = z.infer<typeof ComponentRecordSchema>;
export type PinRecord = z.infer<typeof PinRecordSchema>;
export type DesignatorRecord = z.infer<typeof DesignatorRecordSchema>;
export type ParameterRecord = z.infer<typeof ParameterRecordSchema>;
export type WireRecord = z.infer<typeof WireRecordSchema>;
export type PowerPortRecord = z.infer<typeof PowerPortRecordSchema>;
export type NetLabelRecord = z.infer<typeof NetLabelRecordSchema>;
export type JunctionRecord = z.infer<typeof JunctionRecordSchema>;
export type SheetRecord = z.infer<typeof SheetRecordSchema>;
export type ImplementationRecord = z.infer<typeof ImplementationRecordSchema>;
export type AltiumSchematicParsed = z.infer<typeof AltiumSchematicSchema>;
export type AltiumNetParsed = z.infer<typeof AltiumNetSchema>;
export type ParsedNetlistOutput = z.infer<typeof ParsedNetlistSchema>;
