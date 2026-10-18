# ADR-001 Terraform state in HCP Terraform

Status: Accepted, 2026-10-15 (owner, kickoff answer 4.1)

## Context

tech.md first proposed an S3 backend with native locking. The New Project Playbook (section 5) keeps state in HCP Terraform. An S3 state bucket would also have to exist before Terraform runs, which means creating it outside Terraform and breaking the Terraform-only golden rule.

## Decision

Terraform state for re:Invent Compass lives in **HCP Terraform, in a new workspace** dedicated to this project. All infrastructure is in the owner's personal AWS account, region `us-east-1`.

## Consequences

- tech.md, structure.md and the Spec 5 prompt change from "S3 backend with backend.hcl" to an HCP Terraform `cloud` block. Workspace variables hold account-specific and multi-line values (playbook section 8), never the command line.
- The workspace name and HCP organisation are private configuration, not committed.
- No state bucket to bootstrap.
