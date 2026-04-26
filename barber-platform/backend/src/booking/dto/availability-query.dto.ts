import { IsUUID, IsDateString, IsOptional, IsInt, Min, Max, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';

/** GET query booleans arrive as strings; must never treat `compact=0` like truthy (`Boolean("0")===true`). */
function queryStringTruthyFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase();
    return s === '1' || s === 'true';
  }
  return false;
}

/**
 * Reads the raw query field from the plain object (Express leaves most query values as strings).
 * Global ValidationPipe uses `enableImplicitConversion: false` so we never rely on Boolean("0").
 */
function queryParamTruthy(name: 'compact' | 'chronologicalSlots', obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const raw = (obj as Record<string, unknown>)[name];
  return queryStringTruthyFlag(raw);
}

export class AvailabilityQueryDto {
  @IsUUID()
  businessId: string;

  @IsUUID()
  staffId: string;

  @IsUUID()
  serviceId: string;

  @IsDateString()
  date: string; // YYYY-MM-DD

  /**
   * Consecutive UTC days starting at `date` (default 1). Up to 7 rows per staff/service — improves client-side
   * pick diversity and reduces same-slot herd behavior under load.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  days?: number;

  /** Omit staffName; smaller JSON for mobile / load tests. */
  @IsOptional()
  @Transform(({ obj }) => queryParamTruthy('compact', obj))
  @IsBoolean()
  compact?: boolean;

  /** Cap HH:mm entries (default: all). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(192)
  maxSlotsPerRow?: number;

  /**
   * When true: skip per-viewer shuffle and return HH:mm sorted earliest-first (admin / staff consoles).
   * Default false keeps diverse ordering for customer-facing flows.
   */
  @IsOptional()
  @Transform(({ obj }) => queryParamTruthy('chronologicalSlots', obj))
  @IsBoolean()
  chronologicalSlots?: boolean;
}
