// The Service_Table (design, Component 1; Requirement 4).
//
// One entry per service: the official AWS display name and every identifier that points
// at it. Sources checked when written (17 October 2026): the Terraform AWS provider
// documentation (resource type prefixes), the AWS CDK API reference (aws-cdk-lib module
// names), the AWS SDK for JavaScript v3 package list (every package below was confirmed
// to exist on the npm registry) and the boto3 service index (every service name below
// has a page). Display names follow the official AWS product names.
//
// Added on 18 October 2026 (QA M7): EFS, Systems Manager, OpenSearch Service, Redshift, MSK and
// AppSync. Sources opened that day: the npm registry pages of @aws-sdk/client-efs, -ssm,
// -opensearch, -redshift, -kafka and -appsync; the aws-sdk-js-v3 README of each client for the
// class names (EFSClient, SSMClient, OpenSearchClient, RedshiftClient, KafkaClient,
// AppSyncClient); the boto3 services index (efs, ssm, opensearch, opensearchserverless, es,
// redshift, redshift-data, redshift-serverless, kafka, kafkaconnect, appsync); the Terraform AWS
// provider resource pages (aws_efs_file_system, aws_ssm_parameter, aws_opensearch_domain,
// aws_opensearchserverless_collection, aws_redshift_cluster, aws_redshiftserverless_namespace,
// aws_msk_cluster, aws_mskconnect_connector, aws_appsync_graphql_api); and the aws-cdk-lib module
// READMEs (aws-efs, aws-ssm, aws-opensearchservice, aws-redshift, aws-msk, aws-appsync).
//
// Added on 20 October 2026 (compass-power task 41.3): the AWS SDK for .NET. `nugetPackages` are
// NuGet package ids; every one was confirmed to exist that day by a 200 answer from
// https://api.nuget.org/v3-flatcontainer/<lowercase id>/index.json (a made-up id answered 404).
// `dotnetClientNames` are the <Name> in `new Amazon<Name>Client(`; every one was read that day from
// the namespace page of the AWS SDK for .NET V4 API reference
// (https://docs.aws.amazon.com/sdkfornet/v4/apidocs/items/<folder>/N<folder>.html), for example
// AmazonS3Client, AmazonDynamoDBClient, AmazonIdentityManagementServiceClient (folder IAM),
// AmazonSimpleNotificationServiceClient (folder SNS) and AmazonSimpleSystemsManagementClient
// (folder SSM). The Amazon.Lambda.* packages are the AWS Lambda for .NET libraries (Core, the
// ASP.NET Core server and hosting, the runtime, the System.Text.Json serializer, API Gateway and
// SQS event types, and Annotations). NuGet ids are compared without regard to case, as NuGet does.
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
  | 'terraformType'
  | 'cdkModule'
  | 'sdkPackage'
  | 'sdkClientName'
  | 'boto3Name'
  | 'nugetPackage'
  | 'dotnetClientName';

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
  /** AWS SDK for .NET NuGet package ids, for example `AWSSDK.S3`. */
  nugetPackages: string[];
  /** The `<Name>` in `new Amazon<Name>Client(` (AWS SDK for .NET). */
  dotnetClientNames: string[];
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
    nugetPackages: ['AWSSDK.APIGateway', 'AWSSDK.ApiGatewayV2'],
    dotnetClientNames: ['APIGateway', 'ApiGatewayV2'],
    taxonomyCandidates: ['Amazon API Gateway', 'networking'],
  },
  {
    key: 'appsync',
    displayName: 'AWS AppSync',
    terraformPrefixes: ['aws_appsync_'],
    cdkModules: ['aws-appsync'],
    sdkPackages: ['@aws-sdk/client-appsync'],
    sdkClientNames: ['AppSync'],
    boto3Names: ['appsync'],
    nugetPackages: ['AWSSDK.AppSync'],
    dotnetClientNames: ['AppSync'],
    taxonomyCandidates: ['AWS AppSync'],
  },
  {
    key: 'athena',
    displayName: 'Amazon Athena',
    terraformPrefixes: ['aws_athena_'],
    cdkModules: ['aws-athena'],
    sdkPackages: ['@aws-sdk/client-athena'],
    sdkClientNames: ['Athena'],
    boto3Names: ['athena'],
    nugetPackages: ['AWSSDK.Athena'],
    dotnetClientNames: ['Athena'],
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
    nugetPackages: [
      'AWSSDK.Bedrock',
      'AWSSDK.BedrockRuntime',
      'AWSSDK.BedrockAgent',
      'AWSSDK.BedrockAgentRuntime',
    ],
    dotnetClientNames: ['Bedrock', 'BedrockRuntime', 'BedrockAgent', 'BedrockAgentRuntime'],
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
    nugetPackages: ['AWSSDK.CloudFront'],
    dotnetClientNames: ['CloudFront'],
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
    nugetPackages: ['AWSSDK.CloudWatch', 'AWSSDK.CloudWatchLogs'],
    dotnetClientNames: ['CloudWatch', 'CloudWatchLogs'],
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
    nugetPackages: ['AWSSDK.CognitoIdentityProvider', 'AWSSDK.CognitoIdentity'],
    dotnetClientNames: ['CognitoIdentityProvider', 'CognitoIdentity'],
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
    nugetPackages: ['AWSSDK.DynamoDBv2', 'AWSSDK.DynamoDBStreams'],
    dotnetClientNames: ['DynamoDB', 'DynamoDBStreams'],
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
    nugetPackages: ['AWSSDK.EC2'],
    dotnetClientNames: ['EC2'],
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
    nugetPackages: ['AWSSDK.ECR'],
    dotnetClientNames: ['ECR'],
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
    nugetPackages: ['AWSSDK.ECS'],
    dotnetClientNames: ['ECS'],
    taxonomyCandidates: ['Amazon ECS', 'containers'],
  },
  {
    key: 'efs',
    displayName: 'Amazon EFS',
    terraformPrefixes: ['aws_efs_'],
    cdkModules: ['aws-efs'],
    sdkPackages: ['@aws-sdk/client-efs'],
    sdkClientNames: ['EFS'],
    boto3Names: ['efs'],
    nugetPackages: ['AWSSDK.ElasticFileSystem'],
    dotnetClientNames: ['ElasticFileSystem'],
    taxonomyCandidates: ['Amazon EFS', 'storage'],
  },
  {
    key: 'eks',
    displayName: 'Amazon EKS',
    terraformPrefixes: ['aws_eks_'],
    cdkModules: ['aws-eks'],
    sdkPackages: ['@aws-sdk/client-eks'],
    sdkClientNames: ['EKS'],
    boto3Names: ['eks'],
    nugetPackages: ['AWSSDK.EKS'],
    dotnetClientNames: ['EKS'],
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
    nugetPackages: ['AWSSDK.ElastiCache'],
    dotnetClientNames: ['ElastiCache'],
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
    nugetPackages: ['AWSSDK.EventBridge', 'AWSSDK.Scheduler', 'AWSSDK.CloudWatchEvents'],
    dotnetClientNames: ['EventBridge', 'Scheduler', 'CloudWatchEvents'],
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
    nugetPackages: ['AWSSDK.Glue'],
    dotnetClientNames: ['Glue'],
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
    nugetPackages: ['AWSSDK.IdentityManagement'],
    dotnetClientNames: ['IdentityManagementService'],
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
    nugetPackages: ['AWSSDK.Kinesis', 'AWSSDK.KinesisFirehose'],
    dotnetClientNames: ['Kinesis', 'KinesisFirehose'],
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
    nugetPackages: ['AWSSDK.KeyManagementService'],
    dotnetClientNames: ['KeyManagementService'],
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
    nugetPackages: [
      'AWSSDK.Lambda',
      'Amazon.Lambda.Core',
      'Amazon.Lambda.AspNetCoreServer',
      'Amazon.Lambda.AspNetCoreServer.Hosting',
      'Amazon.Lambda.RuntimeSupport',
      'Amazon.Lambda.Serialization.SystemTextJson',
      'Amazon.Lambda.APIGatewayEvents',
      'Amazon.Lambda.SQSEvents',
      'Amazon.Lambda.Annotations',
    ],
    dotnetClientNames: ['Lambda'],
    taxonomyCandidates: ['AWS Lambda', 'compute'],
  },
  {
    key: 'msk',
    displayName: 'Amazon MSK',
    terraformPrefixes: ['aws_msk_', 'aws_mskconnect_'],
    cdkModules: ['aws-msk'],
    sdkPackages: ['@aws-sdk/client-kafka'],
    sdkClientNames: ['Kafka'],
    boto3Names: ['kafka', 'kafkaconnect'],
    nugetPackages: ['AWSSDK.Kafka', 'AWSSDK.KafkaConnect'],
    dotnetClientNames: ['Kafka', 'KafkaConnect'],
    taxonomyCandidates: ['Amazon MSK', 'analytics'],
  },
  {
    key: 'opensearch',
    displayName: 'Amazon OpenSearch Service',
    terraformPrefixes: ['aws_opensearch_', 'aws_opensearchserverless_'],
    cdkModules: ['aws-opensearchservice'],
    sdkPackages: ['@aws-sdk/client-opensearch'],
    sdkClientNames: ['OpenSearch'],
    boto3Names: ['opensearch', 'opensearchserverless', 'es'],
    nugetPackages: ['AWSSDK.OpenSearchService', 'AWSSDK.OpenSearchServerless'],
    dotnetClientNames: ['OpenSearchService', 'OpenSearchServerless'],
    taxonomyCandidates: ['Amazon OpenSearch Service', 'analytics'],
  },
  {
    key: 'rds',
    displayName: 'Amazon RDS',
    terraformPrefixes: ['aws_db_', 'aws_rds_'],
    cdkModules: ['aws-rds'],
    sdkPackages: ['@aws-sdk/client-rds'],
    sdkClientNames: ['RDS'],
    boto3Names: ['rds'],
    nugetPackages: ['AWSSDK.RDS', 'AWSSDK.RDSDataService'],
    dotnetClientNames: ['RDS', 'RDSDataService'],
    taxonomyCandidates: ['Amazon RDS', 'database'],
  },
  {
    key: 'redshift',
    displayName: 'Amazon Redshift',
    terraformPrefixes: ['aws_redshift_', 'aws_redshiftserverless_'],
    cdkModules: ['aws-redshift'],
    sdkPackages: ['@aws-sdk/client-redshift'],
    sdkClientNames: ['Redshift'],
    boto3Names: ['redshift', 'redshift-data', 'redshift-serverless'],
    nugetPackages: [
      'AWSSDK.Redshift',
      'AWSSDK.RedshiftDataAPIService',
      'AWSSDK.RedshiftServerless',
    ],
    dotnetClientNames: ['Redshift', 'RedshiftDataAPIService', 'RedshiftServerless'],
    taxonomyCandidates: ['Amazon Redshift', 'analytics', 'database'],
  },
  {
    key: 'route53',
    displayName: 'Amazon Route 53',
    terraformPrefixes: ['aws_route53_'],
    cdkModules: ['aws-route53', 'aws-route53-targets'],
    sdkPackages: ['@aws-sdk/client-route-53'],
    sdkClientNames: ['Route53'],
    boto3Names: ['route53'],
    nugetPackages: ['AWSSDK.Route53'],
    dotnetClientNames: ['Route53'],
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
    nugetPackages: ['AWSSDK.S3'],
    dotnetClientNames: ['S3'],
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
    nugetPackages: ['AWSSDK.SageMaker', 'AWSSDK.SageMakerRuntime'],
    dotnetClientNames: ['SageMaker', 'SageMakerRuntime'],
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
    nugetPackages: ['AWSSDK.SecretsManager'],
    dotnetClientNames: ['SecretsManager'],
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
    nugetPackages: ['AWSSDK.SimpleNotificationService'],
    dotnetClientNames: ['SimpleNotificationService'],
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
    nugetPackages: ['AWSSDK.SQS'],
    dotnetClientNames: ['SQS'],
    taxonomyCandidates: ['Amazon SQS'],
  },
  {
    key: 'ssm',
    displayName: 'AWS Systems Manager',
    terraformPrefixes: ['aws_ssm_'],
    cdkModules: ['aws-ssm'],
    sdkPackages: ['@aws-sdk/client-ssm'],
    sdkClientNames: ['SSM'],
    boto3Names: ['ssm'],
    nugetPackages: ['AWSSDK.SimpleSystemsManagement'],
    dotnetClientNames: ['SimpleSystemsManagement'],
    taxonomyCandidates: ['AWS Systems Manager'],
  },
  {
    key: 'stepfunctions',
    displayName: 'AWS Step Functions',
    terraformPrefixes: ['aws_sfn_'],
    cdkModules: ['aws-stepfunctions', 'aws-stepfunctions-tasks'],
    sdkPackages: ['@aws-sdk/client-sfn'],
    sdkClientNames: ['SFN'],
    boto3Names: ['stepfunctions'],
    nugetPackages: ['AWSSDK.StepFunctions'],
    dotnetClientNames: ['StepFunctions'],
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
    nugetPackages: [],
    dotnetClientNames: [],
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
    nugetPackage: new Map(),
    dotnetClientName: new Map(),
  };
  for (const entry of SERVICE_TABLE) {
    for (const prefix of entry.terraformPrefixes) {
      terraform.push([prefix, entry.key]);
    }
    for (const id of entry.cdkModules) exact.cdkModule.set(id, entry.key);
    for (const id of entry.sdkPackages) exact.sdkPackage.set(id, entry.key);
    for (const id of entry.sdkClientNames) exact.sdkClientName.set(id, entry.key);
    for (const id of entry.boto3Names) exact.boto3Name.set(id, entry.key);
    for (const id of entry.nugetPackages) exact.nugetPackage.set(id.toLowerCase(), entry.key);
    for (const id of entry.dotnetClientNames) exact.dotnetClientName.set(id, entry.key);
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
  if (kind === 'nugetPackage') {
    return INDEXES.exact.nugetPackage.get(identifier.toLowerCase());
  }
  return INDEXES.exact[kind].get(identifier);
}

/** Looks an entry up by key. */
export function entryFor(key: ServiceKey): ServiceEntry | undefined {
  return SERVICE_TABLE.find((entry) => entry.key === key);
}
