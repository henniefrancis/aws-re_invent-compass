locals {
  oac_name = "${trimsuffix(var.bucket_name_prefix, "-")}-oac"
}
