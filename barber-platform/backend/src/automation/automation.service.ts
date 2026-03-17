import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerVisitsService } from '../customer-visits/customer-visits.service';
import { QueueService } from '../queues/queue.service';
import type {
  VisitRuleCondition,
  CustomerVisitStats,
  AutomationJobPayload,
} from './automation.types';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';

@Injectable()
export class AutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerVisits: CustomerVisitsService,
    private readonly queues: QueueService,
  ) {}

  /**
   * List automation rules for a business.
   */
  async findAll(businessId: string) {
    return this.prisma.automationRule.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a single automation rule.
   */
  async findById(id: string, businessId: string) {
    const rule = await this.prisma.automationRule.findFirst({
      where: { id, businessId },
    });
    if (!rule) throw new NotFoundException('Automation rule not found');
    return rule;
  }

  /**
   * Create an automation rule.
   */
  async create(dto: CreateAutomationDto) {
    const rule = await this.prisma.automationRule.create({
      data: {
        businessId: dto.businessId,
        name: dto.name,
        isActive: dto.isActive ?? true,
        triggerType: dto.triggerType,
        conditions: (dto.conditions ?? []) as object,
        actions: dto.actions as object,
      },
    });

    if (dto.triggerType === 'scheduled_message' && dto.actions?.sendAt) {
      const sendAt = new Date(dto.actions.sendAt);
      const delay = sendAt.getTime() - Date.now();
      if (delay > 0) {
        await this.queues.automationQueue.add(
          'scheduled_message',
          {
            ruleId: rule.id,
            businessId: rule.businessId,
            triggerType: 'scheduled_message',
            sendAt: dto.actions.sendAt,
          },
          {
            delay,
            jobId: `scheduled:${rule.id}:once`,
            removeOnComplete: { count: 100 },
          },
        );
      }
    }

    return rule;
  }

  /**
   * Update an automation rule.
   */
  async update(id: string, businessId: string, dto: UpdateAutomationDto) {
    await this.findById(id, businessId);
    return this.prisma.automationRule.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.triggerType !== undefined && { triggerType: dto.triggerType }),
        ...(dto.conditions !== undefined && { conditions: dto.conditions as object }),
        ...(dto.actions !== undefined && { actions: dto.actions as object }),
      },
    });
  }

  /**
   * Delete an automation rule.
   */
  async delete(id: string, businessId: string) {
    await this.findById(id, businessId);
    await this.prisma.automationRule.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Schedule an appointment reminder job based on automation rules.
   * Called when an appointment is created.
   */
  async scheduleAppointmentReminder(
    appointmentId: string,
    businessId: string,
    appointmentStartTime: Date,
  ): Promise<void> {
    const rules = await this.prisma.automationRule.findMany({
      where: {
        businessId,
        isActive: true,
        triggerType: 'appointment_reminder',
      },
    });

    for (const rule of rules) {
      const actions = rule.actions as { hoursBefore?: number; channels?: string[] } | null;
      if (!actions?.hoursBefore || !actions?.channels?.length) continue;

      const remindAt = new Date(appointmentStartTime);
      remindAt.setHours(remindAt.getHours() - actions.hoursBefore);
      const delay = remindAt.getTime() - Date.now();
      if (delay <= 0) continue;

      await this.queues.automationQueue.add(
        'appointment_reminder',
        {
          ruleId: rule.id,
          businessId,
          triggerType: 'appointment_reminder',
          appointmentId,
        } as AutomationJobPayload,
        {
          delay,
          jobId: `reminder:${appointmentId}:${rule.id}`,
          removeOnComplete: { count: 500 },
        },
      );
    }
  }

  /**
   * Evaluate visit-based conditions against a customer's stats.
   */
  async evaluateVisitRules(
    customerId: string,
    businessId: string,
    conditions: VisitRuleCondition[],
  ): Promise<{ matched: boolean; failedCondition?: VisitRuleCondition }> {
    const stats = await this.customerVisits.getCustomerVisitStats(
      customerId,
      businessId,
    );

    const statsForEval: CustomerVisitStats = {
      customerNoShowCount: stats.customerNoShowCount,
      lastVisitDate: stats.lastVisitDate ? new Date(stats.lastVisitDate) : null,
      totalCompletedVisits: stats.totalCompletedVisits,
      visitFrequencyPerDay: stats.visitFrequencyPerDay,
    };

    for (const cond of conditions) {
      const matches = this.evaluateCondition(cond, statsForEval);
      if (!matches) {
        return { matched: false, failedCondition: cond };
      }
    }
    return { matched: true };
  }

  private evaluateCondition(
    cond: VisitRuleCondition,
    stats: CustomerVisitStats,
  ): boolean {
    let actual: number;
    switch (cond.type) {
      case 'customer_no_show_count':
        actual = stats.customerNoShowCount;
        break;
      case 'last_visit_date':
        actual = stats.lastVisitDate
          ? Math.floor(
              (Date.now() - stats.lastVisitDate.getTime()) / (24 * 60 * 60 * 1000),
            )
          : 999999;
        break;
      case 'visit_frequency':
        actual = stats.visitFrequencyPerDay;
        break;
      default:
        return false;
    }

    switch (cond.operator) {
      case '>=':
        return actual >= cond.value;
      case '<=':
        return actual <= cond.value;
      case '>':
        return actual > cond.value;
      case '<':
        return actual < cond.value;
      case '==':
        return actual === cond.value;
      default:
        return false;
    }
  }
}
