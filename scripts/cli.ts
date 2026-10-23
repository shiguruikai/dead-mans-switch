#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

import JSON5 from 'json5';
import * as z from 'zod';

import type { SystemData } from '@/types';
import { subDays } from '@/utils/date';

import pkg from '../package.json' with { type: 'json' };

export const CLI_VERSION = pkg.version;

export interface SystemConfig {
  warningDays: number;
  deadDays: number;
}

export function loadSystemConfig(cwd: string = process.cwd()): SystemConfig {
  const configPath = resolve(cwd, 'wrangler.jsonc');

  let rawContent: string;
  try {
    rawContent = readFileSync(configPath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read wrangler.jsonc: ${message}`, { cause: err });
  }

  let parsed: { vars?: { WARNING_DAYS?: string; DEAD_DAYS?: string } };
  try {
    parsed = JSON5.parse(rawContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse wrangler.jsonc: ${message}`, { cause: err });
  }

  const warningDays = Number(parsed.vars?.WARNING_DAYS);
  const deadDays = Number(parsed.vars?.DEAD_DAYS);

  if (!Number.isInteger(warningDays) || !Number.isInteger(deadDays)) {
    throw new TypeError('WARNING_DAYS and DEAD_DAYS in wrangler.jsonc must be valid integers');
  }
  if (warningDays <= 0 || deadDays <= 0) {
    throw new RangeError('WARNING_DAYS and DEAD_DAYS in wrangler.jsonc must be greater than 0');
  }
  if (warningDays >= deadDays) {
    throw new RangeError('WARNING_DAYS must be strictly less than DEAD_DAYS in wrangler.jsonc');
  }

  return {
    warningDays,
    deadDays,
  };
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
  dead_sent_to: z.array(z.string()).default([]),
  push_subscriptions: z.array(pushSubscriptionSchema),
});

export function printUsage(): void {
  console.error(`
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
  --version, -v  Show CLI version
  --remote, -r   Target production environment (Cloudflare Workers)
  --dry-run      Show planned changes without writing or triggering
  --yes, -y      Skip confirmation prompts automatically

Examples:
  pnpm cli status
  pnpm cli ping --remote
  pnpm cli dead -r --dry-run
`);
}

export type ParseCliArgsResult
  = | { action: 'version'; exitCode: 0 }
    | { action: 'help'; exitCode: 0 }
    | { action: 'error'; message: string; exitCode: 2 }
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
        'help': { type: 'boolean', short: 'h', default: false },
        'version': { type: 'boolean', short: 'v', default: false },
        'remote': { type: 'boolean', short: 'r', default: false },
        'dry-run': { type: 'boolean', default: false },
        'yes': { type: 'boolean', short: 'y', default: false },
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
        message: 'No command specified.',
        exitCode: 2,
      };
    }

    if (positionals.length > 1) {
      return {
        action: 'error',
        message: 'Multiple commands were specified.',
        exitCode: 2,
      };
    }

    const command = positionals[0];

    if (!['status', 'ping', 'warning', 'dead', 'reset'].includes(command)) {
      return {
        action: 'error',
        message: `Invalid command "${command}".`,
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      action: 'error',
      message: message,
      exitCode: 2,
    };
  }
}

export function computeNextSystemData(
  command: 'ping' | 'warning' | 'dead' | 'reset',
  currentData: SystemData,
  now: Date = new Date(),
  config: SystemConfig = loadSystemConfig(),
): { updatedData: SystemData; error?: { message: string } } {
  if (command === 'ping' && currentData.status === 'DEAD') {
    return {
      updatedData: currentData,
      error: {
        message: 'Cannot send ping signal because system status is DEAD (locked out).',
      },
    };
  }

  const updatedData = { ...currentData };

  if (command === 'ping') {
    updatedData.status = 'NORMAL';
    updatedData.last_active_at = now.toISOString();
    updatedData.warning_sent_at = null;
  } else if (command === 'warning') {
    updatedData.status = 'NORMAL';
    updatedData.last_active_at = subDays(now, config.warningDays + 1).toISOString();
    updatedData.warning_sent_at = null;
    updatedData.dead_sent_at = null;
    updatedData.dead_sent_to = [];
  } else if (command === 'dead') {
    updatedData.status = 'WARNING';
    updatedData.last_active_at = subDays(now, config.deadDays + 1).toISOString();
    updatedData.warning_sent_at = subDays(now, config.warningDays).toISOString();
    updatedData.dead_sent_at = null;
    updatedData.dead_sent_to = [];
  } else {
    updatedData.status = 'NORMAL';
    updatedData.last_active_at = now.toISOString();
    updatedData.warning_sent_at = null;
    updatedData.dead_sent_at = null;
    updatedData.dead_sent_to = [];
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
      console.error('\n[ERROR] Operation cancelled.');
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

export function quoteShellArg(arg: string): string {
  // 一時ファイルのパス等に空白が含まれても 1 つの引数として渡す（cmd.exe / sh 共通）
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

export function runWrangler(args: string[]): string {
  try {
    return execSync(`pnpm wrangler ${args.map(quoteShellArg).join(' ')}`, { encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch (err) {
    if (err && typeof err === 'object' && 'stderr' in err && typeof err.stderr === 'string') {
      const stderr = err.stderr.trim();
      throw new Error(`Failed to execute Wrangler: ${stderr}`, { cause: err });
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to execute Wrangler: ${message}`, { cause: err });
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

export function isKvValueNotFound(output: string): boolean {
  // wrangler kv key get はキーが存在しない場合も終了コード 0 で「Value not found」を標準出力に出す
  return /^Value not found$/m.test(output);
}

export function getSystemDataFromKV(isRemote: boolean): SystemData {
  const envFlag = isRemote ? '--remote' : '--local';
  const args = ['kv', 'key', 'get', 'system_data', envFlag, '--binding=DMS_KV'];

  try {
    const rawOutput = runWrangler(args);

    if (!rawOutput || isKvValueNotFound(rawOutput)) {
      console.error('[WARN] system_data not found in KV. Initializing default data.');
      return {
        status: 'NORMAL',
        last_active_at: new Date().toISOString(),
        warning_sent_at: null,
        dead_sent_at: null,
        dead_sent_to: [],
        push_subscriptions: [],
      };
    }

    return systemDataSchema.parse(JSON.parse(extractJsonFromText(rawOutput)));
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error('[ERROR] Invalid data format retrieved from KV.');
      console.error('Details:', err.issues);
    } else {
      console.error('[ERROR] Failed to retrieve KV data.');
      if (isRemote) {
        console.error('Troubleshooting: Make sure you are logged in to Cloudflare (`pnpm wrangler login`) or set CLOUDFLARE_API_TOKEN.');
      } else {
        console.error('Troubleshooting: Make sure local dev server (pnpm dev) is running if in local environment.');
      }
      console.error('Details:', err instanceof Error ? err.message : err);
    }
    process.exit(1);
  }
}

export function saveSystemDataToKV(data: SystemData, isRemote: boolean): void {
  const envFlag = isRemote ? '--remote' : '--local';
  const tempFilePath = join(tmpdir(), `dms_kv_${String(Date.now())}_${Math.random().toString(36).slice(2)}.json`);
  let failed = false;
  try {
    writeFileSync(tempFilePath, JSON.stringify(data, null, 2), 'utf-8');
    const args = ['kv', 'key', 'put', 'system_data', '--path', tempFilePath, envFlag, '--binding=DMS_KV'];
    runWrangler(args);
    console.error('[SUCCESS] Successfully updated KV data.');
  } catch (err) {
    console.error('[ERROR] Failed to update KV data.');
    console.error('Troubleshooting: Check Wrangler authentication and binding settings.');
    console.error('Details:', err instanceof Error ? err.message : err);
    failed = true;
  } finally {
    try {
      if (existsSync(tempFilePath)) {
        unlinkSync(tempFilePath);
      }
    } catch {
      // Ignore temporary file deletion error
    }
  }

  // process.exit() は finally を実行せずに終了するため、一時ファイルの削除後に終了する
  if (failed) {
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
    console.error('When running local dev server (pnpm dev), visit http://localhost:5173/cdn-cgi/local/scheduled to manually trigger scheduled events.');
  }
}

export async function main(rawArgs: string[] = process.argv.slice(2)): Promise<void> {
  process.on('SIGINT', () => {
    console.error('\n[ERROR] Process interrupted and cancelled.');
    process.exit(130);
  });

  const parsed = parseCliArgs(rawArgs);

  if (parsed.action === 'version') {
    console.log(`v${CLI_VERSION}`);
    process.exit(parsed.exitCode);
  }

  if (parsed.action === 'help') {
    printUsage();
    process.exit(parsed.exitCode);
  }

  if (parsed.action === 'error') {
    console.error(`[ERROR] ${parsed.message}`);
    printUsage();
    process.exit(parsed.exitCode);
  }

  const { command, isRemote, isDryRun, autoConfirm } = parsed;

  const targetEnvText = isRemote ? 'Production' : 'Local';
  console.error(`Dead Man's Switch CLI v${CLI_VERSION} [${targetEnvText}]\n`);

  const currentData = getSystemDataFromKV(isRemote);

  if (command === 'status') {
    console.log(JSON.stringify(currentData, null, 2));
    return;
  }

  const { updatedData, error } = computeNextSystemData(command, currentData);
  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  console.error('--- Summary of Changes ---');
  if (command === 'dead') {
    console.error(`Status:           ${currentData.status} -> ${updatedData.status} (Simulated for Cron Trigger evaluation)`);
  } else {
    console.error(`Status:           ${currentData.status} -> ${updatedData.status}`);
  }
  console.error(`Last Active At:   ${currentData.last_active_at} -> ${updatedData.last_active_at}`);
  console.error(`Warning Sent At:  ${String(currentData.warning_sent_at)} -> ${String(updatedData.warning_sent_at)}`);
  console.error(`Dead Sent At:     ${String(currentData.dead_sent_at)} -> ${String(updatedData.dead_sent_at)}`);
  console.error(`Dead Sent To:     ${currentData.dead_sent_to.join(', ') || '(none)'} -> ${updatedData.dead_sent_to.join(', ') || '(none)'}`);
  console.error();

  if (command === 'dead') {
    console.error('[NOTE] Status is set to WARNING with last_active_at shifted past DEAD_DAYS.');
    console.error('       The next Cron Trigger execution will validate this condition and transition status to DEAD & send notifications.\n');
  }

  if (isDryRun) {
    console.error('[INFO] Skipped writing and trigger execution because --dry-run flag was set.');
    return;
  }

  if (isRemote && !autoConfirm) {
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY && !process.env.CI;
    if (!isInteractive) {
      console.error('[ERROR] --yes (-y) flag is required for remote execution in non-interactive environments (CI/pipelines).');
      process.exit(1);
    }

    const confirmed = await confirmAction('[WARNING] Are you sure you want to update production KV data?');
    if (!confirmed) {
      console.error('Operation cancelled.');
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
    console.error('[ERROR] Fatal error occurred:');
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
