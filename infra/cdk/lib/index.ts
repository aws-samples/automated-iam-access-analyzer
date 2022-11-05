import * as path from 'path';
import { Aws, Duration } from 'aws-cdk-lib';
import { Rule, RuleTargetInput, Schedule } from 'aws-cdk-lib/aws-events';
import { SfnStateMachine } from 'aws-cdk-lib/aws-events-targets';
import { Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import {
  Chain,
  Choice,
  Condition,
  Fail,
  JsonPath,
  Map as SfnMap,
  Pass,
  StateMachine,
  Wait,
  WaitTime,
} from 'aws-cdk-lib/aws-stepfunctions';
import { CallAwsService, LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { Architecture, Code as LambdaCode, Function as LambdaFunction, Runtime } from 'aws-cdk-lib/aws-lambda';

export interface AutomatedIamAccessAdvisorProps {
  bucket: Bucket;
  roleArns: string[];
  cloudTrailArn: string;
  trailLookBackDays: number;
  schedule: Schedule;
}

export class AutomatedIamAccessAdvisor extends Construct {
  constructor(scope: Construct, id: string, props: AutomatedIamAccessAdvisorProps) {
    super(scope, id);

    if (!props.bucket) {
      throw new Error('Bucket for storing results is required in props');
    }

    const resultsBucket: Bucket = props.bucket;

    // see: https://github.com/awsdocs/aws-cloudtrail-user-guide/blob/master/doc_source/grant-custom-permissions-for-cloudtrail-users.md#read-only-access
    // see: https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-generation.html#access-analyzer-policy-generation-perms
    const cloudTrailAccessor = new Role(this, `${id}CloudTrailAccessRole`, {
      assumedBy: new ServicePrincipal('access-analyzer.amazonaws.com'),
      inlinePolicies: {
        cloudTrailAccess: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['cloudtrail:GetTrail'],
              resources: ['*'],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['iam:GenerateServiceLastAccessedDetails', 'iam:GetServiceLastAccessedDetails'],
              resources: ['*'],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: ['*'],
            }),
          ],
        }),
      },
    });

    const provideContext = new LambdaInvoke(this, `${id}CtxProvider`, {
      lambdaFunction: new LambdaFunction(this, `${id}CtxFn`, {
        code: LambdaCode.fromAsset(path.resolve(__dirname, `../../../lambdas/provide-context/dist`)),
        handler: 'index.handler',
        runtime: Runtime.NODEJS_14_X,
        architecture: Architecture.ARM_64,
        environment: {
          DAYS: `${props.trailLookBackDays}`,
        },
      }),
      payloadResponseOnly: true,
      resultSelector: {
        'CloudTrailArn.$': '$$.Execution.Input.CloudTrailDetails.CloudTrailArn',
        'StartTime.$': '$.StartTime',
        'EndTime.$': '$.EndTime',
      },
      resultPath: '$.CloudTrailDetails',
    });

    const forAllRoles = new SfnMap(this, `${id}IterateRoles`, {
      itemsPath: '$.RoleArns',
      parameters: {
        'RoleArn.$': '$$.Map.Item.Value',
        'Index.$': '$$.Map.Item.Index',
        'CloudTrailDetails.$': '$.CloudTrailDetails',
      },
      outputPath: JsonPath.DISCARD,
    });

    const startRolePoliciesRegeneration = new CallAwsService(this, `${id}GeneratePolicy`, {
      service: 'AccessAnalyzer',
      action: 'startPolicyGeneration',
      parameters: {
        PolicyGenerationDetails: {
          PrincipalArn: JsonPath.stringAt('$.RoleArn'),
        },
        CloudTrailDetails: {
          AccessRole: cloudTrailAccessor.roleArn,
          StartTime: JsonPath.stringAt('$.CloudTrailDetails.StartTime'),
          EndTime: JsonPath.stringAt('$.CloudTrailDetails.EndTime'),
          Trails: [
            {
              AllRegions: true,
              CloudTrailArn: JsonPath.stringAt('$.CloudTrailDetails.CloudTrailArn'),
            },
          ],
        },
      },
      iamResources: [`arn:aws:access-analyzer:${Aws.REGION}:${Aws.ACCOUNT_ID}:*`],
      outputPath: '$.JobId',
      resultPath: '$.JobId',
    });

    const checkRolePoliciesGeneration = new CallAwsService(this, `${id}GetGeneratedPolicy`, {
      service: 'AccessAnalyzer',
      action: 'getGeneratedPolicy',
      parameters: {
        JobId: JsonPath.stringAt('$.JobId'),
      },
      iamResources: [`arn:aws:access-analyzer:${Aws.REGION}:${Aws.ACCOUNT_ID}:*`],
      resultPath: '$.JobResult',
    });

    const onRolePoliciesGenerationStatus = new Choice(this, `${id}CheckStatus`);
    const rolePoliciesGenerationSucceeded = Condition.stringEquals('$.JobResult.JobDetails.Status', 'SUCCEEDED');
    const rolePoliciesGenerationFailed = Condition.or(
      Condition.stringEquals('$.JobResult.JobDetails.Status', 'FAILED'),
      Condition.stringEquals('$.JobResult.JobDetails.Status', 'CANCELED')
    );

    const onFailed = new Fail(this, `${id}ProcessingFailed`);

    const yieldPolicy = new SfnMap(this, `${id}ForEachPolicy`, {
      itemsPath: '$.JobResult.GeneratedPolicyResult.GeneratedPolicies',
      parameters: {
        'Policy.$': 'States.StringToJson($$.Map.Item.Value.Policy)',
      },
      resultPath: '$.Policies',
    });

    yieldPolicy.iterator(
      new Pass(this, `${id}PolicyRetriever`, {
        outputPath: '$.Policy',
      })
    );

    const saveGeneratedPolicies = new CallAwsService(scope, `${id}SavePolicyToS3`, {
      service: 's3',
      action: 'putObject',
      parameters: {
        Bucket: resultsBucket.bucketName,
        'Key.$': `States.Format('{}/policy.json', $.JobResult.GeneratedPolicyResult.Properties.PrincipalArn)`,
        'Body.$': `$.Policies`,
      },
      iamResources: [resultsBucket.arnForObjects('*')],
    });

    const waitAndGoToCheckRolePoliciesGeneration = new Wait(this, `${id}Wait`, {
      time: WaitTime.duration(Duration.minutes(1)),
    }).next(checkRolePoliciesGeneration);

    const processor = Chain.start(provideContext).next(
      forAllRoles.iterator(
        Chain.start(startRolePoliciesRegeneration)
          .next(checkRolePoliciesGeneration)
          .next(
            onRolePoliciesGenerationStatus
              .when(rolePoliciesGenerationSucceeded, yieldPolicy.next(saveGeneratedPolicies))
              .when(rolePoliciesGenerationFailed, onFailed)
              .otherwise(waitAndGoToCheckRolePoliciesGeneration)
          )
      )
    );

    const sm = new StateMachine(this, `${id}Flow`, {
      definition: processor,
    });

    cloudTrailAccessor.grantPassRole(sm.role);
    resultsBucket.grantWrite(sm.role);

    sm.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['access-analyzer:StartPolicyGeneration', 'access-analyzer:GetGeneratedPolicy'],
        resources: [`arn:aws:access-analyzer:${Aws.REGION}:${Aws.ACCOUNT_ID}:*`],
      })
    );

    new Rule(this, `${id}Rule`, {
      schedule: props.schedule,
      targets: [
        new SfnStateMachine(sm, {
          input: RuleTargetInput.fromObject({
            RoleArns: props.roleArns,
            CloudTrailDetails: {
              CloudTrailArn: props.cloudTrailArn,
            },
          }),
        }),
      ],
    });
  }
}
