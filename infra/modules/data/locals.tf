locals {
  table_name = coalesce(var.table_name, "compass-${var.env}")

  # GSI1 answers "all devices for a pass" and GSI2 answers "all passes for a
  # subHash" without a read of the base table (Requirement 6.8).
  gsi1_non_key_attributes = ["deviceHash", "pushToken", "status", "expiresAt"]
  gsi2_non_key_attributes = ["serialNumber", "sessionCode", "status", "expiresAt"]
}
