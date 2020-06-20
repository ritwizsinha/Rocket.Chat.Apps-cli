import { Command, flags } from '@oclif/command';
import cli from 'cli-ux';
import * as Listr from 'listr';

import { FolderDetails } from '../misc';
import { checkReport, getServerInfo, packageAndZip, uploadApp  } from '../misc/deployHelpers';
import { INormalLoginInfo, IPersonalAccessTokenLoginInfo } from '../misc/interfaces';

export default class Deploy extends Command {
    public static description = 'allows deploying an App to a server';

    public static flags = {
        help: flags.help({ char: 'h' }),
        // flag with no value (-f, --force)
        force: flags.boolean({ char: 'f', description: 'forcefully deploy the App, ignores lint & TypeScript errors' }),
        update: flags.boolean({ description: 'updates the app, instead of creating' }),
        code: flags.string({ char: 'c', dependsOn: ['username'], description: '2FA code of the user' }),
        i2fa: flags.boolean({ description: 'interactively ask for 2FA code' }),
    };

    public async run() {
        const { flags } = this.parse(Deploy);

        const fd = new FolderDetails(this);

        try {
            await fd.readInfoFile();
        } catch (e) {
            this.error(e && e.message ? e.message : e, {exit: 2});
        }
        if (flags.i2fa) {
            flags.code = await cli.prompt('2FA code', { type: 'hide' });
        }
        let serverInfo: INormalLoginInfo | IPersonalAccessTokenLoginInfo;
        const tasks = new Listr([
            {
                title: 'Checking Report',
                task: (ctx, task) => {
                    ctx.checkReport = false;
                    try {
                        checkReport(this, fd, flags);
                        ctx.checkReport = true;
                        return;
                    } catch (e) {
                        throw new Error(e && e.message ? e.message : e);
                    }
                },
            },
            {
                title: 'Getting Server Info',
                enabled: (ctx) => ctx.checkReport,
                task: async (ctx, task)  => {
                    ctx.serverInfo = false;
                    try {
                        serverInfo = await getServerInfo(fd);
                        ctx.serverInfo = true;
                    } catch (e) {
                        throw new Error(e && e.message ? e.message : e);
                    }
                },
            },
            {
                title: 'Packaging',
                enabled: (ctx) => ctx.checkReport && ctx.serverInfo,
                task: async (ctx, task) => {
                    ctx.package = false;
                    try {
                        ctx.zipName = await packageAndZip(this, fd);
                        ctx.package = true;
                    } catch (e) {
                        throw new Error(e && e.message ? e.message : e);
                    }
                },
            },
            {
                title: 'Deploying',
                enabled: (ctx) => ctx.checkReport && ctx.serverInfo && ctx.package,
                task: async (ctx, task) => {
                    try {
                        await uploadApp({...flags, ...serverInfo}, fd, ctx.zipName);
                    } catch (e) {
                        throw new Error(e && e.message ? e.message : e);
                    }
                },
            },
        ]);
        tasks.run().catch((e) => {
            return;
        });
    }
}
