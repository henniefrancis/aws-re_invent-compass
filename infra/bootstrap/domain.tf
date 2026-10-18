# The custom domain registration (ADR-031). With register_domain = true the
# bootstrap registers reinvent-compass.vegas with Route 53 Domains, renews it
# every year and keeps it locked against transfer. Registering a domain is a
# purchase: the plan shows a create for aws_route53domains_domain.this, and the
# charge lands on the account when the owner applies it.
#
# Route 53 creates the public hosted zone with the registration; this resource
# reports its id, and deregistering the domain would delete that zone. The
# domain must never be destroyed by Terraform, so prevent_destroy is set:
# removing it from management is a deliberate edit (a removed block), never a
# side effect of turning register_domain off.
#
# The contact details are personal data (POPIA). They come from the git-ignored
# terraform.tfvars, stay in the bootstrap state in HCP Terraform, and are hidden
# from WHOIS by privacy protection on every contact. For .vegas the registry
# still shows an organisation name, so a PERSON contact without one is best.
resource "aws_route53domains_domain" "this" {
  count = var.register_domain ? 1 : 0

  domain_name       = var.hosted_zone_name
  duration_in_years = 1
  auto_renew        = true
  transfer_lock     = true

  admin_privacy      = true
  registrant_privacy = true
  tech_privacy       = true

  dynamic "registrant_contact" {
    for_each = [var.domain_contact]
    content {
      contact_type      = registrant_contact.value.contact_type
      first_name        = registrant_contact.value.first_name
      last_name         = registrant_contact.value.last_name
      organization_name = registrant_contact.value.organization_name
      email             = registrant_contact.value.email
      phone_number      = registrant_contact.value.phone_number
      address_line_1    = registrant_contact.value.address_line_1
      address_line_2    = registrant_contact.value.address_line_2
      city              = registrant_contact.value.city
      state             = registrant_contact.value.state
      zip_code          = registrant_contact.value.zip_code
      country_code      = registrant_contact.value.country_code
    }
  }

  dynamic "admin_contact" {
    for_each = [var.domain_contact]
    content {
      contact_type      = admin_contact.value.contact_type
      first_name        = admin_contact.value.first_name
      last_name         = admin_contact.value.last_name
      organization_name = admin_contact.value.organization_name
      email             = admin_contact.value.email
      phone_number      = admin_contact.value.phone_number
      address_line_1    = admin_contact.value.address_line_1
      address_line_2    = admin_contact.value.address_line_2
      city              = admin_contact.value.city
      state             = admin_contact.value.state
      zip_code          = admin_contact.value.zip_code
      country_code      = admin_contact.value.country_code
    }
  }

  dynamic "tech_contact" {
    for_each = [var.domain_contact]
    content {
      contact_type      = tech_contact.value.contact_type
      first_name        = tech_contact.value.first_name
      last_name         = tech_contact.value.last_name
      organization_name = tech_contact.value.organization_name
      email             = tech_contact.value.email
      phone_number      = tech_contact.value.phone_number
      address_line_1    = tech_contact.value.address_line_1
      address_line_2    = tech_contact.value.address_line_2
      city              = tech_contact.value.city
      state             = tech_contact.value.state
      zip_code          = tech_contact.value.zip_code
      country_code      = tech_contact.value.country_code
    }
  }

  # Registration and its first status checks can take a while at the registry.
  timeouts {
    create = "60m"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Without registration the zone already exists (made with a registration outside
# this configuration) and is only read.
data "aws_route53_zone" "domain" {
  count = var.register_domain ? 0 : 1

  name         = var.hosted_zone_name
  private_zone = false
}
