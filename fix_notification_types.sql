-- fix_notification_types.sql - Fix notification type check constraint
-- Run this in pgAdmin or psql to fix the notification type constraint

-- Step 1: Drop the old constraint
ALTER TABLE notification DROP CONSTRAINT IF EXISTS notification_type_check;

-- Step 2: Add new constraint with all notification types including cancellation_approved and cancellation_rejected
ALTER TABLE notification ADD CONSTRAINT notification_type_check
CHECK (type IN (
  'reservation_new', 
  'reservation_cancelled', 
  'cancellation_request', 
  'cancellation_approved', 
  'cancellation_rejected', 
  'order_new', 
  'reservation_confirmed'
));

-- Verify the fix
SELECT cons.consrc as constraint_definition
FROM pg_constraint cons
JOIN pg_class rel ON rel.oid = cons.conrelid
WHERE rel.relname = 'notification' 
  AND cons.conname = 'notification_type_check';

-- Check existing notifications
SELECT * FROM notification 
WHERE type = 'cancellation_approved' OR type = 'cancellation_rejected'
ORDER BY created_at DESC LIMIT 10;

console.log('✅ Fix completed successfully!');
