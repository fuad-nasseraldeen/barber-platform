import {
  IsString,
  IsBoolean,
  IsOptional,
  IsIn,
  IsArray,
  IsNumber,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AutomationActionDto {
  @IsArray()
  @IsIn(['SMS', 'EMAIL', 'IN_APP'], { each: true })
  channels: ('SMS' | 'EMAIL' | 'IN_APP')[];

  @IsString()
  @MaxLength(500)
  messageTemplate: string;

  @IsOptional()
  @IsNumber()
  hoursBefore?: number;

  @IsOptional()
  @IsString()
  scheduleCron?: string;

  @IsOptional()
  @IsString()
  sendAt?: string;
}

export class CreateAutomationDto {
  @IsUUID()
  businessId: string;

  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsIn(['birthday_message', 'appointment_reminder', 'scheduled_message'])
  triggerType: 'birthday_message' | 'appointment_reminder' | 'scheduled_message';

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object)
  conditions?: Record<string, unknown>[];

  @ValidateNested()
  @Type(() => AutomationActionDto)
  actions: AutomationActionDto;
}
