import Command from '@oclif/command';
import * as FormData from 'form-data';
import * as fs from 'fs';
import fetch from 'node-fetch';
import { Response } from 'node-fetch';
import { AppCompiler, AppPackager, FolderDetails } from '.';
import { IServerInfo } from './interfaces';

export const checkReport = (command: Command, fd: FolderDetails, flags: { [key: string]: any }): void => {
        const compiler = new AppCompiler(command, fd);
        const report = compiler.logDiagnostics();

        if (!report.isValid && !flags.force) {
            throw new Error('TypeScript compiler error(s) occurred');
        }
        return;
};

export const getServerInfo = async (fd: FolderDetails): Promise<IServerInfo> => {
    return new Promise((resolve, reject) => {
        fs.readFile(fd.mergeWithFolder('serverInfo.json'), 'utf8', (error, data) => {
            if (error) {
                reject(error);
            }
            resolve(JSON.parse(data));
        });
    });
};

export const packageAndZip = async (command: Command, fd: FolderDetails): Promise<string> => {
        const packager = new AppPackager(command, fd);
        try {
            return await packager.zipItUp();
        } catch (e) {
            throw new Error(e);
        }
};

export const uploadApp = async (flags: { [key: string]: any }, fd: FolderDetails, zipname: string) => {
        const data = new FormData();
        data.append('app', fs.createReadStream(fd.mergeWithFolder(zipname)));
        try {
            await asyncSubmitData(data, flags, fd);
        } catch (e) {
            throw new Error(e);
        }
};

// tslint:disable-next-line:max-line-length
export const asyncSubmitData = async (data: FormData, flags: { [key: string]: any }, fd: FolderDetails): Promise<void> => {
        let authResult;

        if (!flags.token) {
            let credentials: { username: string, password: string, code?: string };
            credentials = { username: flags.username, password: flags.password };
            if (flags.code) {
                credentials.code = flags.code;
            }

            authResult = await fetch(normalizeUrl(flags.url, '/api/v1/login'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(credentials),
            }).then((res: Response) => res.json());

            if (authResult.status === 'error' || !authResult.data) {
                throw new Error('Invalid username and password or missing 2FA code (if active)');
            }
        } else {
            const verificationResult = await fetch(normalizeUrl(flags.url, '/api/v1/me'), {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Auth-Token': flags.token,
                    'X-User-Id': flags.userid,
                },
            }).then((res: Response) => res.json());

            if (!verificationResult.success) {
                throw new Error('Invalid API token');
            }

            authResult = { data: { authToken: flags.token, userId: flags.userid } };
        }

        let endpoint = '/api/apps';
        if (flags.update) {
            endpoint += `/${fd.info.id}`;
        }

        const deployResult = await fetch(normalizeUrl(flags.url, endpoint), {
            method: 'POST',
            headers: {
                'X-Auth-Token': authResult.data.authToken,
                'X-User-Id': authResult.data.userId,
            },
            body: data,
        }).then((res: Response) => res.json());

        if (deployResult.status === 'error') {
            throw new Error(`Unknown error occurred while deploying ${JSON.stringify(deployResult)}`);
        } else if (!deployResult.success) {
            if (deployResult.status === 'compiler_error') {
                throw new Error(`Deployment compiler errors: \n${ JSON.stringify(deployResult.messages, null, 2) }`);
            }
            throw new Error(`Deployment error: ${ deployResult }`);
        }
    };

    // expects the `path` to start with the /
export const normalizeUrl = (url: string, path: string): string => {
        return url.replace(/\/$/, '') + path;
};