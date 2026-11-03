_For operators: the six step-by-step runbooks for running Compass, and when to open each one._

Each runbook is a short procedure for one job, with the exact commands from the scripts and Terraform in the repository. Read the [Operations](Operations) overview first: it explains the environments, who runs what and the ground rules every runbook follows.

| Runbook                    | Open it when                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| [Release](Release)         | You deploy dev or prod, set up an environment, or publish a new version of the npm package. |
| [Alarms](Alarms)           | An alarm or a budget alert has emailed you, or you need one of the feature switches.        |
| [Kill switch](Kill-Switch) | Abuse or a cost run-up needs every request stopped at the edge at once.                     |
| [Rollback](Rollback)       | A release went wrong, or a retained resource was lost.                                      |
| [Secrets](Secrets)         | You load, rotate or check a secret, or create the Google Wallet class.                      |
| [Teardown](Teardown)       | You remove the dev environment.                                                             |

Every runbook assumes the owner runs it, from the repository, with the AWS profile and the HCP Terraform workspace for the environment. Deploy dev first and prod second.

## Related pages

- [Operations](Operations)
- [AWS architecture](AWS-Architecture)
- [Security](Security)
- [Infrastructure decisions](Decisions-Infrastructure)
