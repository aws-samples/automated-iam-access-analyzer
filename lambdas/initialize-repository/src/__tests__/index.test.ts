import { getFileStream, convertToBuffer, handler } from '../index';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { CodeCommitClient, CreateCommitCommand, CreateCommitCommandOutput, GetBranchCommand, GetBranchCommandOutput, GetBranchOutput, ListBranchesCommand, ListBranchesCommandOutput } from '@aws-sdk/client-codecommit';
import { Readable } from 'stream';

const buildReadable = (contents: string | {}) => {

    const r = new Readable();
    if (typeof contents === 'string') {
        r.push(contents);
    } else {
        r.push(JSON.stringify(contents));
    }

    r.push(null);
    return r;
}

describe('index.getFileStream', () => {

    it('null Body rejects', async () => {
        const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockImplementation((command) => {
            return Promise.resolve({
                Body: null
            });
        });

        await expect(getFileStream('bucket', 'key')).rejects.toThrowError(new Error('No contents'));
        expect(sendSpy).toHaveBeenCalledTimes(1);

        sendSpy.mockRestore();
    });

    it('non-Readable Body rejects', async () => {
        const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockImplementation((command) => Promise.resolve({
            Body: 'body'
        }));

        await expect(getFileStream('bucket', 'key')).rejects.toThrowError(new Error('The contents not in a correct format'));
        expect(sendSpy).toHaveBeenCalledTimes(1);

        sendSpy.mockRestore();
    });

    it('Readable Body resolves', async () => {
        const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockImplementation((command) => Promise.resolve({
            Body: buildReadable({
                Version: "2012-10-17",
                Statement: [
                    {
                        Sid: "PublicRead",
                        Effect: "Allow",
                        Principal: "*",
                        Action: [
                            "s3:GetObject",
                            "s3:GetObjectVersion"
                        ],
                        Resource: [
                            "arn:aws:s3:::DOC-EXAMPLE-BUCKET/*"
                        ]
                    }
                ]
            })
        }));

        const stream = await getFileStream('bucket', 'key');
        expect(stream).toBeInstanceOf(Readable);
        expect(sendSpy).toHaveBeenCalledTimes(1);

        sendSpy.mockRestore();
    });
});

describe('index.convertToBuffer', () => {

    it('resolves', async () => {
        const expected = {
            Version: "2012-10-17",
            Statement: [
                {
                    Sid: "PublicRead",
                    Effect: "Allow",
                    Principal: "*",
                    Action: [
                        "s3:GetObject",
                        "s3:GetObjectVersion"
                    ],
                    Resource: [
                        "arn:aws:s3:::DOC-EXAMPLE-BUCKET/*"
                    ]
                }
            ]
        };
        const stream = buildReadable(expected);

        const buffer = await convertToBuffer(stream);

        expect(buffer).toBeDefined();
        expect(JSON.parse(buffer.toString())).toEqual(expected);
    });
});


describe('index.handler', () => {

    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...OLD_ENV };
    });

    afterAll(() => {
        process.env = { ...OLD_ENV };
    });

    it('CODECOMMIT_REPO_NAME is undefined', async () => {

        await expect(handler()).rejects.toThrow('CODECOMMIT_REPO_NAME');

    });

    it('CODECOMMIT_TARGET_BRANCH_NAME is undefined', async () => {

        process.env.CODECOMMIT_REPO_NAME = 'repoName';

        await expect(handler()).rejects.toThrow('CODECOMMIT_TARGET_BRANCH_NAME');

    });

    it('CODECOMMIT_REPO_FOLDER_PATH is undefined', async () => {

        process.env.CODECOMMIT_REPO_NAME = 'repoName';
        process.env.CODECOMMIT_TARGET_BRANCH_NAME = 'targetBranchName';

        await expect(handler()).rejects.toThrow('CODECOMMIT_REPO_FOLDER_PATH');

    });

    it('BUCKET_NAME is undefined', async () => {

        process.env.CODECOMMIT_REPO_NAME = 'repoName';
        process.env.CODECOMMIT_TARGET_BRANCH_NAME = 'targetBranchName';
        process.env.CODECOMMIT_REPO_FOLDER_PATH = 'repoFolderPath';

        await expect(handler()).rejects.toThrow('BUCKET_NAME');

    });

    it('ALLOW_FILE_KEY is undefined', async () => {

        process.env.CODECOMMIT_REPO_NAME = 'repoName';
        process.env.CODECOMMIT_TARGET_BRANCH_NAME = 'targetBranchName';
        process.env.CODECOMMIT_REPO_FOLDER_PATH = 'repoFolderPath';
        process.env.BUCKET_NAME = 'bucketName';

        await expect(handler()).rejects.toThrow('ALLOW_FILE_KEY');

    });

    it('DENY_FILE_KEY is undefined', async () => {

        process.env.CODECOMMIT_REPO_NAME = 'repoName';
        process.env.CODECOMMIT_TARGET_BRANCH_NAME = 'targetBranchName';
        process.env.CODECOMMIT_REPO_FOLDER_PATH = 'repoFolderPath';
        process.env.BUCKET_NAME = 'bucketName';
        process.env.ALLOW_FILE_KEY = 'allowFileKey';

        await expect(handler()).rejects.toThrow('DENY_FILE_KEY');

    });

    it('ListBranches returns CODECOMMIT_TARGET_BRANCH_NAME', async () => {

        process.env.CODECOMMIT_REPO_NAME = 'repoName';
        process.env.CODECOMMIT_TARGET_BRANCH_NAME = 'targetBranchName';
        process.env.CODECOMMIT_REPO_FOLDER_PATH = 'repoFolderPath';
        process.env.BUCKET_NAME = 'bucketName';
        process.env.ALLOW_FILE_KEY = 'allowFileKey';
        process.env.DENY_FILE_KEY = 'denyFileKey';


        const sendSpy = jest.spyOn(CodeCommitClient.prototype, 'send')
            .mockImplementation((command) => new Promise((resolve, reject) => {
                switch (command.constructor) {
                    case ListBranchesCommand:
                        resolve({
                            branches: [process.env.CODECOMMIT_TARGET_BRANCH_NAME]
                        } as ListBranchesCommandOutput);
                        break;
                    default:
                        reject(new Error('Should never get here'));
                        break;
                }
            }));

        await expect(handler()).resolves.toBeUndefined();
        sendSpy.mockRestore();

    });

    it('ListBranches returns branches without CODECOMMIT_TARGET_BRANCH_NAME', async () => {

        process.env.CODECOMMIT_REPO_NAME = 'repoName';
        process.env.CODECOMMIT_TARGET_BRANCH_NAME = 'targetBranchName';
        process.env.CODECOMMIT_REPO_FOLDER_PATH = 'repoFolderPath';
        process.env.BUCKET_NAME = 'bucketName';
        process.env.ALLOW_FILE_KEY = 'allowFileKey';
        process.env.DENY_FILE_KEY = 'denyFileKey';

        const s3ClientSendSpy = jest.spyOn(S3Client.prototype, 'send')
            .mockImplementation((command) => new Promise((resolve, reject) => {
                switch (command.constructor) {
                    case GetObjectCommand:
                        resolve({
                            Body: buildReadable('asdf')
                        })
                        break;
                    default:
                        reject(new Error('SHould never get here'));
                }
            }));

        const sendSpy = jest.spyOn(CodeCommitClient.prototype, 'send')
            .mockImplementation((command) => new Promise((resolve, reject) => {
                switch (command.constructor) {
                    case ListBranchesCommand:
                        resolve({
                            branches: []
                        } as never as ListBranchesCommandOutput);
                        break;
                    case CreateCommitCommand:
                        resolve({

                        } as CreateCommitCommandOutput)
                    default:
                        reject(new Error('Should never get here'));
                        break;
                }
            }));

        await expect(handler()).resolves.toBeUndefined();

        expect(s3ClientSendSpy).toHaveBeenCalledTimes(2);
        expect(sendSpy).toHaveBeenCalledTimes(2);
        s3ClientSendSpy.mockRestore();
        sendSpy.mockRestore();

    });

});