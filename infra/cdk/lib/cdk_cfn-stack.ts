import * as path from "path";
import { Aws, CfnParameter, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Schedule } from 'aws-cdk-lib/aws-events';
import { Bucket, EventType } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { LambdaDestination } from 'aws-cdk-lib/aws-s3-notifications';
import { Architecture, Code as LambdaCode, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';
import { AutomatedIamAccessAdvisor } from './index';
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Repository as CodeCommitRepository, Code as CodeCommitCode } from "aws-cdk-lib/aws-codecommit";

export class CdkCfnStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const roleArn = new CfnParameter(this, `roleArn`, {
      type: 'String'
    });

    const trailArn = new CfnParameter(this, `trailArn`, {
      type: 'String'
    });

    const triggerSchedule = new CfnParameter(this, 'schedule', {
      type: 'String',
      description: 'The EventBridge rule schedule for periodically running the Automated IAM Access Advisor',
      default: 'cron(0 18 ? * MON-FRI *)'
    });

    const trailLookBackDays = new CfnParameter(this, 'trailLookBack', {
      type: 'Number',
      description: 'The number of days of history to analyze the specified trail',
      default: 90
    });

    const resultsBucket = new Bucket(this, `${id}ResultStorage`, {
      versioned: true,
      autoDeleteObjects: true, // CRITICAL: remove for prod!
      removalPolicy: RemovalPolicy.DESTROY // CRITICAL: remove for prod!
    });

    const mainBranchName = 'main';

    const repo = new CodeCommitRepository(this, `${id}TestRepo`, {
      repositoryName: 'testrepo',
      code: CodeCommitCode.fromDirectory(path.join(__dirname, '../../../repo/'), mainBranchName),
      description: 'A repository to test Automated IAM Access Advisor'
    });

    // CREATING THE LAMBDA THAT WILL BE TRIGGERED UPON POLICY UPLOAD ON S3 (once step function is finished)
    const processNewPolicy = new LambdaFunction(this, `${id}RepoPusher`, {
      code: LambdaCode.fromAsset(path.resolve(__dirname, `../../../lambdas/push-policies-to-repository/dist`)),
      runtime: Runtime.NODEJS_14_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      environment: {
        CODECOMMIT_REPO_NAME: repo.repositoryName,
        CODECOMMIT_TARGET_BRANCH_NAME: mainBranchName,
        CODECOMMIT_REPO_FOLDER_PATH: '/',
      },
      initialPolicy: [new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'codecommit:GetBranch',
          'codecommit:CreateCommit',
          'codecommit:GetFile',
          'codecommit:PutFile'
        ],
        resources: [
          repo.repositoryArn
        ],
      })]
    });

    resultsBucket.grantRead(processNewPolicy);

    resultsBucket.addEventNotification(EventType.OBJECT_CREATED, new LambdaDestination(processNewPolicy));

    new AutomatedIamAccessAdvisor(this, `${id}Aa`, {
      bucket: resultsBucket,
      roleArns: [roleArn.valueAsString],
      cloudTrailArn: trailArn.valueAsString,
      schedule: Schedule.expression(triggerSchedule.valueAsString),
      trailLookBackDays: trailLookBackDays.valueAsNumber
    });

  }
}
