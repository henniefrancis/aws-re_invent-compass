locals {
  oac_name = "${trimsuffix(var.bucket_name_prefix, "-")}-oac"

  # The Google Wallet images (pass-service task 47). They must match GOOGLE_IMAGES in
  # packages/pass-service/src/google/google-layout.ts; a static test keeps them equal.
  wallet_images = toset(["wide-logo-v1.png", "hero-v1.png"])
}
