locals {
  table_name = coalesce(var.table_name, "compass-${var.env}")
}
