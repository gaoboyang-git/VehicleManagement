-- Issue 7 renames legacy idle vehicles to inUse for the new two-state workflow.
UPDATE "Vehicle"
SET "status" = 'inUse'
WHERE "status" IN ('idle', '闲置');
