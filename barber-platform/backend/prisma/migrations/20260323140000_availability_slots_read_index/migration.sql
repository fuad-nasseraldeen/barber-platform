-- Cover hot read: WHERE businessId AND staffId AND date AND status = 'AVAILABLE'
CREATE INDEX "availability_slots_businessId_staffId_date_status_idx" ON "availability_slots"("businessId", "staffId", "date", "status");
