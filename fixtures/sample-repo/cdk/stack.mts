import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';

// Sample data only. Not a real stack.
export class SampleStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string) {
    super(scope, id);
    new sqs.Queue(this, 'Jobs', { visibilityTimeout: cdk.Duration.seconds(30) });
  }
}
