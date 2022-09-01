import './Array.extensions';
import { S3Client, GetObjectCommand, GetObjectCommandInput } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { CodeCommitClient, CreateCommitCommand, GetBranchCommand, GetFileCommand } from '@aws-sdk/client-codecommit';
import { S3Event } from 'aws-lambda';

type PermissionSet = string[];

type Statement = {
    Sid: string | undefined;
    Effect: 'Allow' | 'Deny';
    Action: string[];
    Resource: string | string[];
};

type PolicyDocument = {
    Version: string;
    Statement: Statement[];
};

const codeCommitClient = new CodeCommitClient({});
const s3client = new S3Client({});

const {
    CODECOMMIT_REPO_NAME,
    CODECOMMIT_TARGET_BRANCH_NAME,
    CODECOMMIT_REPO_FOLDER_PATH
} = process.env;

export const getPoliciesStream = async (bucket: string, key: string, versionId?: string): Promise<Readable> => {
    const params: GetObjectCommandInput = {
        Bucket: bucket,
        Key: key,
        VersionId: versionId,
    };

    const response = await s3client.send(new GetObjectCommand(params));

    if (!response.Body) {
        throw new Error('No contents');
    }

    if (!(response.Body instanceof Readable)) {
        throw new Error('The contents not in a correct format');
    }

    return response.Body as Readable;
};

export const convertToBuffer = (stream: Readable): Promise<Buffer> => new Promise<Buffer>((resolve, reject) => {

    const chunks: Buffer[] = [];

    stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
    stream.once('end', () => resolve((Buffer.concat(chunks))));
    stream.once('error', reject);
});

export const getFile = async (filePath: string) => {
    const getFileCommandOutput = await codeCommitClient.send(new GetFileCommand({
        repositoryName: CODECOMMIT_REPO_NAME,
        commitSpecifier: `${CODECOMMIT_TARGET_BRANCH_NAME}`,
        filePath: filePath
    }));

    if (!getFileCommandOutput.fileContent) {
        throw new Error(`file at ${filePath} not found`);
    }

    return Buffer.from(getFileCommandOutput.fileContent);
};

export const gitCommitPolicies = async (policies: Buffer, fileName: string) => {

    const getBranchCommandOutput = await codeCommitClient.send(new GetBranchCommand({
        branchName: CODECOMMIT_TARGET_BRANCH_NAME,
        repositoryName: CODECOMMIT_REPO_NAME,
    }));

    // TODO: should it behave this way?
    const { commitId: lastCommit } = getBranchCommandOutput.branch ?? {};

    await codeCommitClient.send(new CreateCommitCommand({
        repositoryName: CODECOMMIT_REPO_NAME,
        branchName: CODECOMMIT_TARGET_BRANCH_NAME,
        parentCommitId: lastCommit,
        putFiles: [
            {
                fileContent: policies,
                filePath: `${CODECOMMIT_REPO_FOLDER_PATH?.replace(/\/$/, '')}/${fileName}`,
            }
        ]
    }));
};

export const handler = async (event: S3Event) => {

    console.log(JSON.stringify(event, null, 2));

    const allowFile = await getFile('/allow.json');
    const allowPermissions = JSON.parse(allowFile.toString('utf-8')) as PermissionSet;

    const denyFile = await getFile('/deny.json');
    const denyPermissions = JSON.parse(denyFile.toString('utf-8')) as PermissionSet;

    for (const record of event.Records) {
        const { bucket, object } = record.s3;
        const filePath = decodeURIComponent(object.key);
        const policiesStream = await getPoliciesStream(bucket.name, filePath, object.versionId);
        const policiesBuffer = await convertToBuffer(policiesStream);

        let generatedPolicies = JSON.parse(policiesBuffer.toString('utf-8')) as PolicyDocument[];

        generatedPolicies = generatedPolicies.map(p => {
            let [allowed, denied] = p.Statement.partition(s => s.Effect === 'Allow');

            allowed = allowed.map(a => ({
                Sid: a.Sid,
                Effect: a.Effect,
                Action: Array.from(
                    new Set(a.Action.concat(allowPermissions).filter(ac => !denyPermissions.includes(ac)))
                ),
                Resource: a.Resource
            }));

            denied = denied.map(d => ({
                Sid: d.Sid,
                Effect: d.Effect,
                Action: Array.from(
                    new Set(d.Action.filter(dc => !allowPermissions.includes(dc)).concat(denyPermissions))
                ),
                Resource: d.Resource
            }));

            return {
                Version: p.Version,
                Statement: [...allowed, ...denied]
            };
        });

        await gitCommitPolicies(Buffer.from(JSON.stringify(generatedPolicies, null, 2), 'utf-8'), filePath);
    }
};