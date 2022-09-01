import { convertToBuffer, getPoliciesStream, gitCommitPolicies, getFile, handler } from '../index';
import { S3Client } from '@aws-sdk/client-s3';
import { CodeCommitClient, CreateCommitCommand, GetBranchCommand, GetBranchCommandOutput, GetBranchOutput, GetFileCommand, GetFileCommandOutput } from '@aws-sdk/client-codecommit';
import { Readable } from 'stream';
import { S3EventRecord } from 'aws-lambda';

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

describe('index.getPoliciesStream', () => {

    it('null Body rejects', async () => {
        const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockImplementation((command) => {
            return Promise.resolve({
                Body: null
            });
        });

        await expect(getPoliciesStream('bucket', 'key')).rejects.toThrowError(new Error('No contents'));
        expect(sendSpy).toHaveBeenCalledTimes(1);

        sendSpy.mockRestore();
    });

    it('non-Readable Body rejects', async () => {
        const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockImplementation((command) => Promise.resolve({
            Body: 'body'
        }));

        await expect(getPoliciesStream('bucket', 'key')).rejects.toThrowError(new Error('The contents not in a correct format'));
        expect(sendSpy).toHaveBeenCalledTimes(1);

        sendSpy.mockRestore();
    });

    it('Readable Body resolves', async () => {
        const sendSpy = jest.spyOn(S3Client.prototype, 'send').mockImplementation((command) => Promise.resolve({
            Body: buildReadable([{
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
            }])
        }));

        const stream = await getPoliciesStream('bucket', 'key');
        expect(stream).toBeInstanceOf(Readable);
        expect(sendSpy).toHaveBeenCalledTimes(1);

        sendSpy.mockRestore();
    });
});

describe('index.convertToBuffer', () => {

    it('resolves', async () => {
        const expected = [{
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
        }];
        const stream = buildReadable(expected);

        const buffer = await convertToBuffer(stream);

        expect(buffer).toBeDefined();
        expect(JSON.parse(buffer.toString())).toEqual(expected);
    });
});

describe('index.gitCommitPolicies', () => {

    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...OLD_ENV };
    });

    afterAll(() => {
        process.env = { ...OLD_ENV };
    });

    it('get branch rejects on getting branch', async () => {

        const expectedError = new Error('Failed for some reason');
        const sendSpy = jest.spyOn(CodeCommitClient.prototype, 'send')
            .mockImplementation((_) => Promise.reject(expectedError));

        await expect(gitCommitPolicies(Buffer.from(''), 'fileName')).rejects.toThrowError(expectedError);
        expect(sendSpy).toHaveBeenCalledTimes(1);
        sendSpy.mockRestore();
    });

    it('get branch rejects on pushing commit', async () => {

        const expectedError = new Error('Failed for some reason');
        const sendSpy = jest.spyOn(CodeCommitClient.prototype, 'send')
            .mockImplementation((command) => new Promise((resolve, reject) => {
                switch (command.constructor) {
                    case GetBranchCommand:
                        resolve({
                            branch: {
                                commitId: 'commitId'
                            }
                        } as GetBranchCommandOutput);
                        break;
                    case CreateCommitCommand:
                        reject(expectedError);
                        break;
                    default:
                        reject(new Error('Should never get here'));
                        break;
                }
            }));

        await expect(async () => await gitCommitPolicies(Buffer.from(''), 'fileName')).rejects.toThrowError(expectedError);
        expect(sendSpy).toHaveBeenCalledTimes(2);
        sendSpy.mockRestore();
    });


    it('get branch resolves with empty branch', async () => {

        process.env.CODECOMMIT_REPO_FOLDER_PATH = 'temp';

        const sendSpy = jest.spyOn(CodeCommitClient.prototype, 'send')
            .mockImplementation((command) => new Promise((resolve, reject) => {
                switch (command.constructor) {
                    case GetBranchCommand:
                        console.log('branching');
                        resolve({
                            branch: undefined
                        } as GetBranchCommandOutput);
                        break;
                    case CreateCommitCommand:
                        resolve('succeeded');
                        break;
                    default:
                        reject(new Error('Should never get here'));
                        break;
                }
            }));

        await expect(gitCommitPolicies(Buffer.from(''), 'fileName')).resolves.toBeUndefined();
        expect(sendSpy).toHaveBeenCalledTimes(2);
        sendSpy.mockRestore();
    });

    it('get branch resolves on pushing commit', async () => {

        process.env.CODECOMMIT_REPO_FOLDER_PATH = 'temp';

        const sendSpy = jest.spyOn(CodeCommitClient.prototype, 'send')
            .mockImplementation((command) => new Promise((resolve, reject) => {
                switch (command.constructor) {
                    case GetBranchCommand:
                        resolve({
                            branch: {
                                commitId: 'commitId'
                            }
                        } as GetBranchCommandOutput);
                        break;
                    case CreateCommitCommand:
                        resolve('succeeded');
                        break;
                    default:
                        reject(new Error('Should never get here'));
                        break;
                }
            }));

        await expect(gitCommitPolicies(Buffer.from(''), 'fileName')).resolves.toBeUndefined();
        expect(sendSpy).toHaveBeenCalledTimes(2);
        sendSpy.mockRestore();
    });
});


describe('index.getFile', () => {

    it('on filePath not found', () => {

        const filePath = 'filePath';
        const expected = `file at ${filePath} not found`;

        const sendSpy = jest.spyOn(CodeCommitClient.prototype, 'send')
            .mockImplementation((command) => new Promise((resolve, reject) => {
                switch (command.constructor) {
                    case GetFileCommand:
                        resolve({
                            fileContent: undefined
                        } as GetFileCommandOutput);
                        break;
                    default:
                        reject(new Error('Should never get here'));
                        break;
                }
            }));

        expect(getFile(filePath)).rejects.toThrow(expected);
        expect(sendSpy).toHaveBeenCalledTimes(1);

        sendSpy.mockRestore();

    });

    it('on filePath found', async () => {

        const filePath = 'filePath';
        const expected = Buffer.from(JSON.stringify([
            "s3:PutObject"
        ]));
        
        const sendSpy = jest.spyOn(CodeCommitClient.prototype, 'send')
            .mockImplementation((command) => new Promise((resolve, reject) => {
                switch (command.constructor) {
                    case GetFileCommand:
                        resolve({
                            fileContent: expected as Uint8Array
                        } as GetFileCommandOutput);
                        break;
                    default:
                        reject(new Error('Should never get here'));
                        break;
                }
            }));

        const actual = await getFile(filePath);
        expect(actual).toStrictEqual(expected);
        expect(sendSpy).toHaveBeenCalledTimes(1);

        sendSpy.mockRestore();
        
    });
});


describe('index.handler', () => {

    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        jest.restoreAllMocks();
        process.env = { ...OLD_ENV };
    });

    afterAll(() => {
        process.env = { ...OLD_ENV };
    });

    it('empty record list succeeds', async () => {

        const sendSpy = jest.spyOn(CodeCommitClient.prototype, 'send')
            .mockImplementation((command) => new Promise((resolve, reject) => {
                switch (command.constructor) {
                    case GetFileCommand:
                        resolve({
                            fileContent: Buffer.from(JSON.stringify([
                                "s3:PutObject"
                            ])) as Uint8Array
                        } as GetFileCommandOutput);
                        break;
                    default:
                        reject(new Error('Should never get here'));
                        break;
                }
            }));

        await expect(handler({
            Records: []
        })).resolves.toBeUndefined();
        expect(sendSpy).toHaveBeenCalledTimes(2);

    });

    it('non-empty record list succeeds', async () => {

        const s3SendSpy = jest.spyOn(S3Client.prototype, 'send').mockImplementation((command) => Promise.resolve({
            Body: buildReadable([{
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
            }])
        }));

        const codeCommitSendSpy = jest.spyOn(CodeCommitClient.prototype, 'send')
            .mockImplementation((command) => new Promise((resolve, reject) => {
                switch (command.constructor) {
                    case GetFileCommand:
                        resolve({
                            fileContent: Buffer.from(JSON.stringify([
                                "s3:PutObject"
                            ])) as Uint8Array
                        } as GetFileCommandOutput);
                        break;
                    case GetBranchCommand:
                        resolve({
                            branch: {
                                commitId: 'commitId'
                            }
                        } as GetBranchOutput);
                        break;
                    case CreateCommitCommand:
                        resolve('succeeded');
                        break;
                    default:
                        reject(new Error('Should never get here'));
                        break;
                }
            }));

        await expect(handler({
            Records: [{
                s3: {
                    bucket: {
                        name: 'name'
                    },
                    object: {
                        key: 'key',
                        versionId: undefined,
                    }
                }
            } as S3EventRecord]
        })).resolves.toBeUndefined();

        expect(s3SendSpy).toHaveBeenCalledTimes(1);
        expect(codeCommitSendSpy).toHaveBeenCalledTimes(4);
    });

    it('non-empty record list rejects on empty policy', async () => {

        const expectedError = new Error('No contents');
        const s3SendSpy = jest.spyOn(S3Client.prototype, 'send').mockImplementation((command) => Promise.resolve({
            Body: undefined
        }));

        const codeCommitSendSpy = jest.spyOn(CodeCommitClient.prototype, 'send')
            .mockImplementation((command) => new Promise((resolve, reject) => {
                switch (command.constructor) {
                    case GetFileCommand:
                        resolve({
                            fileContent: Buffer.from(JSON.stringify([
                                "s3:PutObject"
                            ])) as Uint8Array
                        } as GetFileCommandOutput);
                        break;
                    case GetBranchCommand:
                        resolve({
                            branch: {
                                commitId: 'commitId'
                            }
                        } as GetBranchOutput);
                        break;
                    case CreateCommitCommand:
                        reject(expectedError)
                        break;
                    default:
                        reject(new Error('Should never get here'));
                        break;
                }
            }));

        await expect(handler({
            Records: [{
                s3: {
                    bucket: {
                        name: 'name'
                    },
                    object: {
                        key: 'key',
                        versionId: undefined,
                    }
                }
            } as S3EventRecord]
        })).rejects.toThrowError(expectedError);
        expect(s3SendSpy).toHaveBeenCalledTimes(1);
        expect(codeCommitSendSpy).toHaveBeenCalledTimes(2);
    });

});