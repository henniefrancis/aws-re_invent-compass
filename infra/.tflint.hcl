# tflint configuration for every root and module under infra/.
# Run from a root or module directory: tflint --config=<path to this file>
# Only the bundled terraform ruleset is used so the check needs no network.

config {
  call_module_type = "local"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}
