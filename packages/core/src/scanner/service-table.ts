// The Service_Table (design, Component 1; Requirement 4).
//
// One entry per service: the official AWS display name and every identifier that points
// at it. Sources checked when written (17 October 2026): the Terraform AWS provider
// documentation (resource type prefixes), the AWS CDK API reference (aws-cdk-lib module
// names), the AWS SDK for JavaScript v3 package list (every package below was confirmed
// to exist on the npm registry) and the boto3 service index (every service name below
// has a page). Display names follow the official AWS product names.
//
// Terraform matching rule: a prefix that ends in `_` matches any type that starts with
// it; a prefix without a trailing `_` matches only that exact type. The longest matching
// prefix wins, so `aws_cloudwatch_event_` (EventBridge) beats `aws_cloudwatch_`.
//
// Taxonomy candidates are the display name plus, where one fits, a category token of the
// synthetic catalog (fixtures/synthetic/generate.ts): compute, storage, database,
// networking, security, analytics, machine-learning, containers. The real catalog's labels
// are confirmed against the owner's SP5 shape diff; unmatched services are reported
// honestly until then.

/** A service key, for example `s3`. */
export type ServiceKey = string;

/** The kinds of identifier a detector can produce. */
export type IdentifierKind =
  'terraformType' | 'cdkModule' | 'sdkPackage' | 'sdkClientName' | 'boto3Name';

/** One service and every identifier that points at it. */
export interface ServiceEntry {
  key: ServiceKey;
  displayName: string;
  terraformPrefixes: string[];
  cdkModules: string[];
  sdkPackages: string[];
  /** The `<Name>` in `new <Name>Client(`. */
  sdkClientNames: string[];
  boto3Names: string[];
  taxonomyCandidates: string[];
}

/** The mapping table. */
export const SERVICE_TABLE: readonly ServiceEntry[] = [
  {
    key: 'apigateway',
    displayName: 'Amazon API Gateway',
    terraformPrefixes: ['aws_api_gateway_', 'aws_apigatewayv2_'],
    cdkModules: ['aws-apigateway', 'aws-apigatewayv2'],
    sdkPackages: ['@aws-sdk/client-api-gateway', '@aws-sdk/client-apigatewayv2'],
    sdkClientNames: ['ApiGateway', 'ApiGatewayV2'],
    boto3Names: ['apigateway', 'apigatewayv2'],
    taxonomyCandidates: ['Amazon API Gateway', 'networking'],
  },
  {
    key: 'athena',
    displayName: 'Amazon Athena',
    terraformPrefixes: ['aws_athena_'],
    cdkModules: ['aws-athena'],
    sdkPackages: ['@aws-sdk/client-athena'],
    sdkClientNames: ['Athena'],
    boto3Names: ['athena'],
    taxonomyCandidates: ['Amazon Athena', 'analytics'],
  },
  {
    key: 'bedrock',
    displayName: 'Amazon Bedrock',
    terraformPrefixes: ['aws_bedrock_', 'aws_bedrockagent_'],
    cdkModules: ['aws-bedrock'],
    sdkPackages: [
      '@aws-sdk/client-bedrock',
      '@aws-sdk/client-bedrock-runtime',
      '@aws-sdk/client-bedrock-agent',
      '@aws-sdk/client-bedrock-agent-runtime',
    ],
    sdkClientNames: ['Bedrock', 'BedrockRuntime', 'BedrockAgent', 'BedrockAgentRuntime'],
    boto3Names: ['bedrock', 'bedrock-runtime', 'bedrock-agent', 'bedrock-agent-runtime'],
    taxonomyCandidates: ['Amazon Bedrock', 'machine-learning'],
  },
  {
    key: 'cloudfront',
    displayName: 'Amazon CloudFront',
    terraformPrefixes: ['aws_cloudfront_'],
    cdkModules: ['aws-cloudfront', 'aws-cloudfront-origins'],
    sdkPackages: ['@aws-sdk/client-cloudfront'],
    sdkClientNames: ['CloudFront'],
    boto3Names: ['cloudfront'],
    taxonomyCandidates: ['Amazon CloudFront', 'networking'],
  },
  {
    key: 'cloudwatch',
    displayName: 'Amazon CloudWatch',
    terraformPrefixes: ['aws_cloudwatch_'],
    cdkModules: ['aws-cloudwatch', 'aws-logs'],
    sdkPackages: ['@aws-sdk/client-cloudwatch', '@aws-sdk/client-cloudwatch-logs'],
    sdkClientNames: ['CloudWatch', 'CloudWatchLogs'],
    boto3Names: ['cloudwatch', 'logs'],
    taxonomyCandidates: ['Amazon CloudWatch'],
  },
  {
    key: 'cognito',
    displayName: 'Amazon Cognito',
    terraformPrefixes: ['aws_cognito_'],
    cdkModules: ['aws-cognito'],
    sdkPackages: ['@aws-sdk/client-cognito-identity-provider', '@aws-sdk/client-cognito-identity'],
    sdkClientNames: ['CognitoIdentityProvider', 'CognitoIdentity'],
    boto3Names: ['cognito-idp', 'cognito-identity'],
    taxonomyCandidates: ['Amazon Cognito', 'security'],
  },
  {
    key: 'dynamodb',
    displayName: 'Amazon DynamoDB',
    terraformPrefixes: ['aws_dynamodb_'],
    cdkModules: ['aws-dynamodb'],
    sdkPackages: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb'],
    sdkClientNames: ['DynamoDB'],
    boto3Names: ['dynamodb'],
    taxonomyCandidates: ['Amazon DynamoDB', 'database'],
  },
  {
    key: 'ec2',
    displayName: 'Amazon EC2',
    terraformPrefixes: [
      'aws_instance',
      'aws_ec2_',
      'aws_ebs_',
      'aws_launch_template',
      'aws_key_pair',
      'aws_ami',
      'aws_ami_',
      'aws_eip',
      'aws_eip_',
    ],
    cdkModules: ['aws-ec2'],
    sdkPackages: ['@aws-sdk/client-ec2'],
    sdkClientNames: ['EC2'],
    boto3Names: ['ec2'],
    taxonomyCandidates: ['Amazon EC2', 'compute'],
  },
  {
    key: 'ecr',
    displayName: 'Amazon ECR',
    terraformPrefixes: ['aws_ecr_'],
    cdkModules: ['aws-ecr'],
    sdkPackages: ['@aws-sdk/client-ecr'],
    sdkClientNames: ['ECR'],
    boto3Names: ['ecr'],
    taxonomyCandidates: ['Amazon ECR', 'containers'],
  },
  {
    key: 'ecs',
    displayName: 'Amazon ECS',
    terraformPrefixes: ['aws_ecs_'],
    cdkModules: ['aws-ecs', 'aws-ecs-patterns'],
    sdkPackages: ['@aws-sdk/client-ecs'],
    sdkClientNames: ['ECS'],
    boto3Names: ['ecs'],
    taxonomyCandidates: ['Amazon ECS', 'containers'],
  },
  {
    key: 'eks',
    displayName: 'Amazon EKS',
    terraformPrefixes: ['aws_eks_'],
    cdkModules: ['aws-eks'],
    sdkPackages: ['@aws-sdk/client-eks'],
    sdkClientNames: ['EKS'],
    boto3Names: ['eks'],
    taxonomyCandidates: ['Amazon EKS', 'containers'],
  },
  {
    key: 'elasticache',
    displayName: 'Amazon ElastiCache',
    terraformPrefixes: ['aws_elasticache_'],
    cdkModules: ['aws-elasticache'],
    sdkPackages: ['@aws-sdk/client-elasticache'],
    sdkClientNames: ['ElastiCache'],
    boto3Names: ['elasticache'],
    taxonomyCandidates: ['Amazon ElastiCache', 'database'],
  },
  {
    key: 'eventbridge',
    displayName: 'Amazon EventBridge',
    terraformPrefixes: ['aws_cloudwatch_event_', 'aws_scheduler_', 'aws_pipes_'],
    cdkModules: ['aws-events', 'aws-events-targets', 'aws-scheduler'],
    sdkPackages: ['@aws-sdk/client-eventbridge', '@aws-sdk/client-scheduler'],
    sdkClientNames: ['EventBridge', 'Scheduler'],
    boto3Names: ['events', 'scheduler'],
    taxonomyCandidates: ['Amazon EventBridge'],
  },
  {
    key: 'glue',
    displayName: 'AWS Glue',
    terraformPrefixes: ['aws_glue_'],
    cdkModules: ['aws-glue'],
    sdkPackages: ['@aws-sdk/client-glue'],
    sdkClientNames: ['Glue'],
    boto3Names: ['glue'],
    taxonomyCandidates: ['AWS Glue', 'analytics'],
  },
  {
    key: 'iam',
    displayName: 'AWS IAM',
    terraformPrefixes: ['aws_iam_'],
    cdkModules: ['aws-iam'],
    sdkPackages: ['@aws-sdk/client-iam'],
    sdkClientNames: ['IAM'],
    boto3Names: ['iam'],
    taxonomyCandidates: ['AWS IAM', 'security'],
  },
  {
    key: 'kinesis',
    displayName: 'Amazon Kinesis',
    terraformPrefixes: ['aws_kinesis_'],
    cdkModules: ['aws-kinesis', 'aws-kinesisfirehose'],
    sdkPackages: ['@aws-sdk/client-kinesis', '@aws-sdk/client-firehose'],
    sdkClientNames: ['Kinesis', 'Firehose'],
    boto3Names: ['kinesis', 'firehose'],
    taxonomyCandidates: ['Amazon Kinesis', 'analytics'],
  },
  {
    key: 'kms',
    displayName: 'AWS KMS',
    terraformPrefixes: ['aws_kms_'],
    cdkModules: ['aws-kms'],
    sdkPackages: ['@aws-sdk/client-kms'],
    sdkClientNames: ['KMS'],
    boto3Names: ['kms'],
    taxonomyCandidates: ['AWS KMS', 'security'],
  },
  {
    key: 'lambda',
    displayName: 'AWS Lambda',
    terraformPrefixes: ['aws_lambda_'],
    cdkModules: ['aws-lambda', 'aws-lambda-nodejs', 'aws-lambda-event-sources'],
    sdkPackages: ['@aws-sdk/client-lambda'],
    sdkClientNames: ['Lambda'],
    boto3Names: ['lambda'],
    taxonomyCandidates: ['AWS Lambda', 'compute'],
  },
  {
    key: 'rds',
    displayName: 'Amazon RDS',
    terraformPrefixes: ['aws_db_', 'aws_rds_'],
    cdkModules: ['aws-rds'],
    sdkPackages: ['@aws-sdk/client-rds'],
    sdkClientNames: ['RDS'],
    boto3Names: ['rds'],
    taxonomyCandidates: ['Amazon RDS', 'database'],
  },
  {
    key: 'route53',
    displayName: 'Amazon Route 53',
    terraformPrefixes: ['aws_route53_'],
    cdkModules: ['aws-route53', 'aws-route53-targets'],
    sdkPackages: ['@aws-sdk/client-route-53'],
    sdkClientNames: ['Route53'],
    boto3Names: ['route53'],
    taxonomyCandidates: ['Amazon Route 53', 'networking'],
  },
  {
    key: 's3',
    displayName: 'Amazon S3',
    terraformPrefixes: ['aws_s3_'],
    cdkModules: ['aws-s3'],
    sdkPackages: ['@aws-sdk/client-s3', '@aws-sdk/lib-storage'],
    sdkClientNames: ['S3'],
    boto3Names: ['s3'],
    taxonomyCandidates: ['Amazon S3', 'storage'],
  },
  {
    key: 'sagemaker',
    displayName: 'Amazon SageMaker AI',
    terraformPrefixes: ['aws_sagemaker_'],
    cdkModules: ['aws-sagemaker'],
    sdkPackages: ['@aws-sdk/client-sagemaker', '@aws-sdk/client-sagemaker-runtime'],
    sdkClientNames: ['SageMaker', 'SageMakerRuntime'],
    boto3Names: ['sagemaker', 'sagemaker-runtime'],
    taxonomyCandidates: ['Amazon SageMaker AI', 'Amazon SageMaker', 'machine-learning'],
  },
  {
    key: 'secretsmanager',
    displayName: 'AWS Secrets Manager',
    terraformPrefixes: ['aws_secretsmanager_'],
    cdkModules: ['aws-secretsmanager'],
    sdkPackages: ['@aws-sdk/client-secrets-manager'],
    sdkClientNames: ['SecretsManager'],
    boto3Names: ['secretsmanager'],
    taxonomyCandidates: ['AWS Secrets Manager', 'security'],
  },
  {
    key: 'sns',
    displayName: 'Amazon SNS',
    terraformPrefixes: ['aws_sns_'],
    cdkModules: ['aws-sns', 'aws-sns-subscriptions'],
    sdkPackages: ['@aws-sdk/client-sns'],
    sdkClientNames: ['SNS'],
    boto3Names: ['sns'],
    taxonomyCandidates: ['Amazon SNS'],
  },
  {
    key: 'sqs',
    displayName: 'Amazon SQS',
    terraformPrefixes: ['aws_sqs_'],
    cdkModules: ['aws-sqs'],
    sdkPackages: ['@aws-sdk/client-sqs'],
    sdkClientNames: ['SQS'],
    boto3Names: ['sqs'],
    taxonomyCandidates: ['Amazon SQS'],
  },
  {
    key: 'stepfunctions',
    displayName: 'AWS Step Functions',
    terraformPrefixes: ['aws_sfn_'],
    cdkModules: ['aws-stepfunctions', 'aws-stepfunctions-tasks'],
    sdkPackages: ['@aws-sdk/client-sfn'],
    sdkClientNames: ['SFN'],
    boto3Names: ['stepfunctions'],
    taxonomyCandidates: ['AWS Step Functions'],
  },
  {
    key: 'vpc',
    displayName: 'Amazon VPC',
    terraformPrefixes: [
      'aws_vpc',
      'aws_vpc_',
      'aws_subnet',
      'aws_subnet_',
      'aws_route',
      'aws_route_table',
      'aws_route_table_',
      'aws_internet_gateway',
      'aws_internet_gateway_',
      'aws_nat_gateway',
      'aws_nat_gateway_',
      'aws_network_acl',
      'aws_network_acl_',
      'aws_security_group',
      'aws_security_group_',
    ],
    cdkModules: [],
    sdkPackages: [],
    sdkClientNames: [],
    boto3Names: [],
    taxonomyCandidates: ['Amazon VPC', 'networking'],
  },
];

interface Indexes {
  terraform: readonly (readonly [string, ServiceKey])[];
  exact: Record<Exclude<IdentifierKind, 'terraformType'>, Map<string, ServiceKey>>;
}

function buildIndexes(): Indexes {
  const terraform: (readonly [string, ServiceKey])[] = [];
  const exact: Indexes['exact'] = {
    cdkModule: new Map(),
    sdkPackage: new Map(),
    sdkClientName: new Map(),
    boto3Name: new Map(),
  };
  for (const entry of SERVICE_TABLE) {
    for (const prefix of entry.terraformPrefixes) {
      terraform.push([prefix, entry.key]);
    }
    for (const id of entry.cdkModules) exact.cdkModule.set(id, entry.key);
    for (const id of entry.sdkPackages) exact.sdkPackage.set(id, entry.key);
    for (const id of entry.sdkClientNames) exact.sdkClientName.set(id, entry.key);
    for (const id of entry.boto3Names) exact.boto3Name.set(id, entry.key);
  }
  terraform.sort((a, b) => b[0].length - a[0].length);
  return { terraform, exact };
}

const INDEXES = buildIndexes();

/**
 * Resolves one detector identifier to a service key, or undefined when the table has no
 * entry (the identifier is then counted as unmapped).
 */
export function resolveService(kind: IdentifierKind, identifier: string): ServiceKey | undefined {
  if (kind === 'terraformType') {
    for (const [prefix, key] of INDEXES.terraform) {
      if (identifier === prefix || (prefix.endsWith('_') && identifier.startsWith(prefix))) {
        return key;
      }
    }
    return undefined;
  }
  return INDEXES.exact[kind].get(identifier);
}

/** Looks an entry up by key. */
export function entryFor(key: ServiceKey): ServiceEntry | undefined {
  return SERVICE_TABLE.find((entry) => entry.key === key);
}
