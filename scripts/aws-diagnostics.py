#!/usr/bin/env python3
"""Report infrastructure status without dumping tokens, user data, or logs."""
import json
import re
import sys


def scrub(message):
    value = re.sub(r'https?://\S+', '[URL omitted]', str(message))
    value = re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email omitted]', value)
    value = re.sub(r'(?i)(secret|password|token|authorization)\s*[:=]\s*\S+', r'\1=[omitted]', value)
    return value[:1200]


def main():
    import boto3
    session = boto3.Session(region_name='us-west-2')
    if session.client('sts').get_caller_identity()['Account'] != '912390896286':
        raise RuntimeError('Unexpected AWS account; diagnostics stopped.')
    cfn = session.client('cloudformation')
    try:
        stack = cfn.describe_stacks(StackName='wordmemo-sync-d3p8fj75zj86rx')['Stacks'][0]
        print('Backend: ' + stack['StackStatus'])
        events = cfn.describe_stack_events(StackName=stack['StackId'])['StackEvents']
        failures = [e for e in events if 'FAILED' in e.get('ResourceStatus', '')][:12]
        for event in failures:
            print(json.dumps({'resource': event.get('LogicalResourceId'), 'status': event['ResourceStatus'],
                              'reason': scrub(event.get('ResourceStatusReason', ''))}))
    except cfn.exceptions.ClientError as error:
        if 'does not exist' in str(error):
            print('Backend stack does not exist yet.')
        else:
            raise
    amplify = session.client('amplify')
    jobs = amplify.list_jobs(appId='d3p8fj75zj86rx', branchName='production', maxResults=3)['jobSummaries']
    for job in jobs:
        print('Amplify job ' + job['jobId'] + ': ' + job['status'])


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Infrastructure diagnostic: ' + scrub(error), file=sys.stderr)
        sys.exit(1)
