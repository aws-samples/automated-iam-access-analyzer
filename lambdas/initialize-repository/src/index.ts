import {
    S3Client,
    GetObjectCommand,
    GetObjectCommandInput
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import {
    CodeCommitClient,
    CreateCommitCommand,
    ListBranchesCommand
} from '@aws-sdk/client-codecommit';

const codeCommitClient = new CodeCommitClient({});
const s3client = new S3Client({});

export const getFileStream = async (bucket: string, key: string, versionId?: string): Promise<Readable> => {
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

export const handler = async () => {

    const {
        BUCKET_NAME,
        ALLOW_FILE_KEY,
        DENY_FILE_KEY,
        CODECOMMIT_REPO_NAME,
        CODECOMMIT_TARGET_BRANCH_NAME,
        CODECOMMIT_REPO_FOLDER_PATH
    } = process.env;

    if (!CODECOMMIT_REPO_NAME) {
        throw new Error('CODECOMMIT_REPO_NAME');
    }

    if (!CODECOMMIT_TARGET_BRANCH_NAME) {
        throw new Error('CODECOMMIT_TARGET_BRANCH_NAME');
    }

    if (!CODECOMMIT_REPO_FOLDER_PATH) {
        throw new Error('CODECOMMIT_REPO_FOLDER_PATH');
    }

    if (!BUCKET_NAME) {
        throw new Error('BUCKET_NAME');
    }

    if (!ALLOW_FILE_KEY) {
        throw new Error('ALLOW_FILE_KEY');
    }

    if (!DENY_FILE_KEY) {
        throw new Error('DENY_FILE_KEY');
    }

    const getBranchOutput = await codeCommitClient.send(
        new ListBranchesCommand({
            repositoryName: CODECOMMIT_REPO_NAME
        })
    );

    if (!getBranchOutput.branches ||
        (
            getBranchOutput.branches
            &&
            !getBranchOutput.branches
                .includes(CODECOMMIT_TARGET_BRANCH_NAME)
        )
    ) {

        const allowFileStream = await getFileStream(BUCKET_NAME, ALLOW_FILE_KEY);
        const denyFileStream = await getFileStream(BUCKET_NAME, DENY_FILE_KEY);

        const allowFileBuffer = await convertToBuffer(allowFileStream);
        const denyFileBuffer = await convertToBuffer(denyFileStream);

        await codeCommitClient.send(new CreateCommitCommand({
            repositoryName: CODECOMMIT_REPO_NAME,
            branchName: CODECOMMIT_TARGET_BRANCH_NAME,
            putFiles: [{
                fileContent: allowFileBuffer,
                filePath: `${CODECOMMIT_REPO_FOLDER_PATH.replace(/\/$/, '')}/allow.json`
            }, {
                fileContent: denyFileBuffer,
                filePath: `${CODECOMMIT_REPO_FOLDER_PATH.replace(/\/$/, '')}/deny.json`
            }]
        }));

    }
};