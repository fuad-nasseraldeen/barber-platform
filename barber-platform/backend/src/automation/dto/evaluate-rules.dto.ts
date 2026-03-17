import {
  IsUUID,
  IsArray,
  ValidateNested,
  IsIn,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export class VisitRuleConditionDto {
  @IsIn(['customer_no_show_count', 'last_visit_date', 'visit_frequency'])
  type: 'customer_no_show_count' | 'last_visit_date' | 'visit_frequency';

  @IsIn(['>=', '<=', '>', '<', '=='])
  operator: '>=' | '<=' | '>' | '<' | '==';

  @IsNumber()
  value: number;
}

export class EvaluateRulesDto {
  @IsUUID()
  customerId: string;

  @IsUUID()
  businessId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VisitRuleConditionDto)
  conditions: VisitRuleConditionDto[];
}
