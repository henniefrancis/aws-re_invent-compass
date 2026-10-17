# Sample data only. Not a real deployment.
provider "aws" {
  region = "us-east-1"
}

resource "aws_s3_bucket" "uploads" {
  bucket = "sample-uploads-bucket"
}

resource "aws_lambda_function" "resizer" {
  function_name = "sample-resizer"
  handler       = "index.handler"
  runtime       = "nodejs24.x"
  role          = "arn:aws:iam::000000000000:role/sample"
}

resource "aws_dynamodb_table" "items" {
  name         = "sample-items"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
}
