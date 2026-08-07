#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

import * as z from 'zod';

import type { SystemData } from '@/types';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };
export const CLI_VERSION = pkg.version;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SystemConfig {
  warningDays: number;
  deadDays: number;
}

export function loadSystemConfig(cwd: string = process.cwd()): SystemConfig {
  try {
    const configPath = resolve(cwd, 'wrangler.jsonc');
    const rawContent = readFileSync(configPath, 'utf-8');
    const cleanedJson = rawContent.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    const parsed = JSON.parse(cleanedJson) as { vars?: { WARNING_DAYS?: string; DEAD_DAYS?: string } };

    const warningDays = Number.parseInt(parsed.vars?.WARNING_DAYS ?? '7', 10);
    const deadDays = Number.parseInt(parsed.vars?.DEAD_DAYS ?? '14', 10);

    return {
      warningDays: Number.isNaN(warningDays) ? 7 : warningDays,
      deadDays: Number.isNaN(deadDays) ? 14 : deadDays,
    };
  } catch {
    return { warningDays: 7, deadDays: 14 };
  }
}

export const pushSubscriptionSchema = z.object({
  endpoint: z.string(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});

export const systemDataSchema = z.object({
  status: z.enum(['NORMAL', 'WARNING', 'DEAD']),
  last_active_at: z.string(),
  warning_sent_at: z.string().nullable(),
  dead_sent_at: z.string().nullable(),
  push_subscriptions: z.array(pushSubscriptionSchema),
});

export function printUsage(): void {
  console.log(`
Dead Man's Switch CLI v${CLI_VERSION}

Usage:
  pnpm cli <command> [options]

Commands:
  status   Show current system status
  ping     Send ping signal (updates last_active_at and restores NORMAL status)
  warning  Simulate WARNING (survival check reminder) trigger
  dead     Simulate DEAD (post-mortem notification) trigger
  reset    Reset status to NORMAL

Options:
  --help, -h     Show help
  --remote, -r   Target production environment (Cloudflare Workers)
  --dry-run      Show planned changes without writing or triggering
  --yes, -y      Skip confirmation prompts automatically
  --version, -v  Show CLI version

Examples:
  pnpm cli status
  pnpm cli ping --remote
  pnpm cli warning --dry-run
  pnpm cli warning --remote
  pnpm cli dead --remote
  pnpm cli reset --remote
`);
}

export type ParseCliArgsResult
  = | { action: 'version'; exitCode: 0 }
    | { action: 'help'; exitCode: 0 }
    | { action: 'error'; errorCode: string; message: string; exitCode: 2 }
    | {
      action: 'run';
      command: 'status' | 'ping' | 'warning' | 'dead' | 'reset';
      isRemote: boolean;
      isDryRun: boolean;
      autoConfirm: boolean;
    };

export function parseCliArgs(rawArgs: string[]): ParseCliArgsResult {
  try {
    const { values, positionals } = parseArgs({
      args: rawArgs,
      options: {
        'remote': { type: 'boolean', short: 'r', default: false },
        'dry-run': { type: 'boolean', default: false },
        'yes': { type: 'boolean', short: 'y', default: false },
        'version': { type: 'boolean', short: 'v', default: false },
        'help': { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
      strict: true,
    });

    if (values.version) {
      return { action: 'version', exitCode: 0 };
    }

    if (values.help) {
      return { action: 'help', exitCode: 0 };
    }

    if (positionals.length === 0) {
      return {
        action: 'error',
        errorCode: 'E1002',
        message: 'Error: No command specified.',
        exitCode: 2,
      };
    }

    const command = positionals[0];
    if (!['status', 'ping', 'warning', 'dead', 'reset'].includes(command)) {
      return {
        action: 'error',
        errorCode: 'E1002',
        message: `Error: Invalid command "${command}".`,
        exitCode: 2,
      };
    }

    return {
      action: 'run',
      command: command as 'status' | 'ping' | 'warning' | 'dead' | 'reset',
      isRemote: values.remote,
      isDryRun: values['dry-run'],
      autoConfirm: values.yes,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      action: 'error',
      errorCode: 'E1002',
      message: `Error: ${message}`,
      exitCode: 2,
    };
  }
}

export function computeNextSystemData(
  command: 'ping' | 'warning' | 'dead' | 'reset',
  currentData: SystemData,
  now: Date = new Date(),
  config: SystemConfig = loadSystemConfig(),
): { updatedData: SystemData; error?: { errorCode: string; message: string } } {
  if (command === 'ping' && currentData.status === 'DEAD') {
    return {
      updatedData: currentData,
      error: {
        errorCode: 'E1005',
        message: 'Error: Cannot send ping signal because system status is DEAD (locked out).',
      },
    };
  }

  const updatedData: SystemData = { ...currentData };

  if (command === 'ping') {
    updatedData.status = 'NORMAL';
    updatedData.last_active_at = now.toISOString();
    updatedData.warning_sent_at = null;
  } else if (command === 'warning') {
    const warningMs = (config.warningDays + 1) * MS_PER_DAY;
    const warningTimeAgo = new Date(now.getTime() - warningMs).toISOString();
    updatedData.status = 'NORMAL';
    updatedData.last_active_at = warningTimeAgo;
    updatedData.warning_sent_at = null;
    updatedData.dead_sent_at = null;
  } else if (command === 'dead') {
    const deadMs = (config.deadDays + 1) * MS_PER_DAY;
    const warningSentMs = config.warningDays * MS_PER_DAY;
    const deadTimeAgo = new Date(now.getTime() - deadMs).toISOString();
    const warningTimeAgo = new Date(now.getTime() - warningSentMs).toISOString();
    updatedData.status = 'WARNING';
    updatedData.last_active_at = deadTimeAgo;
    updatedData.warning_sent_at = warningTimeAgo;
    updatedData.dead_sent_at = null;
  } else {
    updatedData.status = 'NORMAL';
    updatedData.last_active_at = now.toISOString();
    updatedData.warning_sent_at = null;
    updatedData.dead_sent_at = null;
  }

  return { updatedData };
}

export async function confirmAction(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    const handleSigint = () => {
      rl.close();
      console.error('\n[E1300] Operation cancelled.');
      process.exit(130);
    };

    rl.on('SIGINT', handleSigint);

    try {
      rl.question(`${question} (y/N): `, (answer) => {
        rl.removeListener('SIGINT', handleSigint);
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      });
    } catch (err) {
      rl.removeListener('SIGINT', handleSigint);
      rl.close();
      throw err;
    }
  });
}

export function runWrangler(args: string[]): string {
  try {
    const isWin = process.platform === 'win32';
    const command = isWin ? 'cmd.exe' : 'pnpm';
    const commandArgs = isWin ? ['/c', 'pnpm', 'wrangler', ...args] : ['wrangler', ...args];
    return execFileSync(command, commandArgs, { encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'stderr' in err && typeof err.stderr === 'string') {
      const stderr = err.stderr.trim();
      throw new Error(`[E1006] Failed to execute Wrangler: ${stderr}`, { cause: err });
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[E1006] Failed to execute Wrangler: ${message}`, { cause: err });
  }
}

export function extractJsonFromText(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || start >= end) {
    return text;
  }
  return text.slice(start, end + 1);
}

export function getSystemDataFromKV(isRemote: boolean): SystemData {
  const envFlag = isRemote ? '--remote' : '--local';
  const args = ['kv', 'key', 'get', 'system_data', envFlag, '--binding=DMS_KV'];

  try {
    const rawOutput = runWrangler(args);

    if (!rawOutput) {
      console.error('[WARN] system_data not found in KV. Initializing default data.');
      return {
        status: 'NORMAL',
        last_active_at: new Date().toISOString(),
        warning_sent_at: null,
        dead_sent_at: null,
        push_subscriptions: [],
      };
    }

    const cleanedOutput = extractJsonFromText(rawOutput);
    const parsedJson: unknown = JSON.parse(cleanedOutput);
    return systemDataSchema.parse(parsedJson);
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error('[E1003] Invalid data format retrieved from KV.');
      console.error('Details:', err.issues);
    } else {
      console.error('[E1003] Failed to retrieve KV data.');
      console.error('Troubleshooting: Make sure local dev server (pnpm dev) is running if in local environment.');
      console.error('Details:', err instanceof Error ? err.message : err);
    }
    process.exit(1);
  }
}

export function saveSystemDataToKV(data: SystemData, isRemote: boolean): void {
  const envFlag = isRemote ? '--remote' : '--local';
  const jsonString = JSON.stringify(data);
  const args = ['kv', 'key', 'put', 'system_data', jsonString, envFlag, '--binding=DMS_KV'];

  try {
    runWrangler(args);
    console.error('[SUCCESS] Successfully updated KV data.');
  } catch (err) {
    console.error('[E1004] Failed to update KV data.');
    console.error('Troubleshooting: Check Wrangler authentication and binding settings.');
    console.error('Details:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

export function triggerCronCheck(isRemote: boolean): void {
  console.error('\n[INFO] About Cron Trigger execution:');

  if (isRemote) {
    console.error('Updated production KV data.');
    console.error('Status evaluation and email notification will run on the next Cron Trigger execution.');
    console.error('Check Cron Trigger settings at Cloudflare Dashboard > Workers & Pages > [Worker] > Settings > Triggers.');
  } else {
    console.error('Updated local KV data.');
    console.error('When running local dev server (pnpm dev), visit http://localhost:5173/__scheduled to manually trigger scheduled events.');
  }
}

export async function main(rawArgs: string[] = process.argv.slice(2)): Promise<void> {
  process.on('SIGINT', () => {
    console.error('\n[E1300] Process interrupted and cancelled.');
    process.exit(130);
  });

  const parsed = parseCliArgs(rawArgs);

  if (parsed.action === 'version') {
    console.log(`v${CLI_VERSION}`);
    process.exit(0);
  }

  if (parsed.action === 'help') {
    printUsage();
    process.exit(0);
  }

  if (parsed.action === 'error') {
    console.error(`[${parsed.errorCode}] ${parsed.message}`);
    printUsage();
    process.exit(parsed.exitCode);
  }

  const { command, isRemote, isDryRun, autoConfirm } = parsed;

  const targetEnvText = isRemote ? 'Production' : 'Local';
  console.log(`Dead Man's Switch CLI v${CLI_VERSION} [${targetEnvText}]\n`);

  const currentData = getSystemDataFromKV(isRemote);

  if (command === 'status') {
    console.log(JSON.stringify(currentData, null, 2));
    return;
  }

  const { updatedData, error } = computeNextSystemData(command, currentData);
  if (error) {
    console.error(`[${error.errorCode}] ${error.message}`);
    process.exit(1);
  }

  console.log('--- Summary of Changes ---');
  if (command === 'dead') {
    console.log(`Status:           ${currentData.status} -> ${updatedData.status} (Simulated for Cron Trigger evaluation)`);
  } else {
    console.log(`Status:           ${currentData.status} -> ${updatedData.status}`);
  }
  console.log(`Last Active At:   ${currentData.last_active_at} -> ${updatedData.last_active_at}`);
  console.log(`Warning Sent At:  ${String(currentData.warning_sent_at)} -> ${String(updatedData.warning_sent_at)}`);
  console.log(`Dead Sent At:     ${String(currentData.dead_sent_at)} -> ${String(updatedData.dead_sent_at)}`);
  console.log();

  if (command === 'dead') {
    console.log('[NOTE] Status is set to WARNING with last_active_at shifted past DEAD_DAYS.');
    console.log('       The next Cron Trigger execution will validate this condition and transition status to DEAD & send notifications.\n');
  }

  if (isDryRun) {
    console.log('[INFO] Skipped writing and trigger execution because --dry-run flag was set.');
    return;
  }

  if (isRemote && !autoConfirm) {
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY && !process.env.CI;
    if (!isInteractive) {
      console.error('[E1001] Error: --yes (-y) flag is required for remote execution in non-interactive environments (CI/pipelines).');
      process.exit(1);
    }

    const confirmed = await confirmAction('[WARNING] Are you sure you want to update production KV data?');
    if (!confirmed) {
      console.log('Operation cancelled.');
      return;
    }
  }

  saveSystemDataToKV(updatedData, isRemote);

  if (['warning', 'dead'].includes(command)) {
    triggerCronCheck(isRemote);
    console.error(`\n[SUCCESS] ${command.toUpperCase()} simulation completed successfully. Please check your inbox and notifications.`);
  } else if (command === 'ping') {
    console.error('\n[SUCCESS] Successfully sent ping (survival signal).');
  } else {
    console.error('\n[SUCCESS] Successfully reset status to NORMAL.');
  }
}

export function isMain(
  filename: string = import.meta.filename,
  argv1: string | undefined = process.argv[1],
): boolean {
  if (!argv1) return false;
  return resolve(argv1) === resolve(filename) || basename(argv1) === basename(filename);
}

if (isMain()) {
  main().catch((err: unknown) => {
    console.error('[E9999] Fatal error occurred:');
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
