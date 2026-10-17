import boto3

# Sample data only.
sns = boto3.client("sns")


def announce(message):
    sns.publish(TopicArn="arn:aws:sns:us-east-1:000000000000:sample", Message=message)
