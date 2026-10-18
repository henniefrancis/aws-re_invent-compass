# Sample repo

This folder is made-up sample data for the re:Invent Compass scanner and demo.
It is not a real project. It holds no secrets, keys or real account ids.

It shows the ways AWS appears in code that the scanner recognises:

- Terraform in `infra/main.tf`
- AWS CDK in `cdk/stack.mts`
- AWS SDK for JavaScript v3 in `src/storage.mts` and `src/table.mts`
- boto3 in `tools/report.py`
- dependencies in `package.json` and `requirements.txt`

The `.gitignore` lists `ignored-output`, so the scanner skips that folder if it exists.
