import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { SystemData } from '../src/types';
import { subDaysIso } from '../src/utils/date';
import {
  CLI_VERSION,
  computeNextSystemData,
  extractJsonFromText,
  isMain,
  loadSystemConfig,
  parseCliArgs,
  printUsage,
} from './cli';

describe('Dead Man\'s Switch CLI ユニットテスト (scripts/cli.ts)', () => {
  describe('loadSystemConfig (設定ファイルの動的読み込み)', () => {
    it('wrangler.jsonc から WARNING_DAYS と DEAD_DAYS を正しく読み込めること', () => {
      const config = loadSystemConfig();
      expect(config.warningDays).toBe(1);
      expect(config.deadDays).toBe(2);
    });

    it('存在しないディレクトリの場合詳細なエラーメッセージとともに例外をスローすること', () => {
      expect(() => loadSystemConfig('/non/existent/path')).toThrow('Failed to read wrangler.jsonc:');
    });
  });

  describe('extractJsonFromText (JSON レスポンスの抽出フィルター)', () => {
    it('Wrangler のログが混在していても JSON 文字列部分のみを正しく抽出できること', () => {
      const rawWithLog = ' \x1b[33m[WRANGLER] update available \x1b[0m\n{"status":"NORMAL","last_active_at":"2026-01-01T00:00:00.000Z"}\n';
      const extracted = extractJsonFromText(rawWithLog);
      expect(extracted).toBe('{"status":"NORMAL","last_active_at":"2026-01-01T00:00:00.000Z"}');
    });

    it('JSON の波括弧が含まれない場合はそのままの文字列を返すこと', () => {
      const text = 'no json string here';
      expect(extractJsonFromText(text)).toBe('no json string here');
    });
  });

  describe('parseCliArgs (引数解析およびPOSIX終了コード判定)', () => {
    it('--version / -v フラグ指定時に action: version と exitCode: 0 を返すこと（§9.1）', () => {
      const result1 = parseCliArgs(['--version']);
      expect(result1).toEqual({ action: 'version', exitCode: 0 });

      const result2 = parseCliArgs(['-v']);
      expect(result2).toEqual({ action: 'version', exitCode: 0 });
    });

    it('--help / -h フラグ指定時に action: help と exitCode: 0 を返すこと（§1.9）', () => {
      const result1 = parseCliArgs(['--help']);
      expect(result1).toEqual({ action: 'help', exitCode: 0 });

      const result2 = parseCliArgs(['-h']);
      expect(result2).toEqual({ action: 'help', exitCode: 0 });
    });

    it('コマンド未指定時にエラーレスポンスと exitCode 2 を返すこと（§6.1, §6.4）', () => {
      const result = parseCliArgs([]);
      expect(result).toEqual({
        action: 'error',
        message: 'No command specified.',
        exitCode: 2,
      });
    });

    it('無効なコマンド指定時にエラーレスポンスと exitCode 2 を返すこと（§6.1, §6.4）', () => {
      const result = parseCliArgs(['invalid-cmd']);
      expect(result).toEqual({
        action: 'error',
        message: 'Invalid command "invalid-cmd".',
        exitCode: 2,
      });
    });

    it('未定義のフラグ（タイポ等）が指定された場合にエラーを返すこと（strict モード）', () => {
      const result = parseCliArgs(['ping', '--invalid-option']);
      expect(result.action).toBe('error');
      if (result.action === 'error') {
        expect(result.exitCode).toBe(2);
      }
    });

    it('正常なコマンドと各種オプションを正しく解析できること（§1.1）', () => {
      const result = parseCliArgs(['ping', '--remote', '--dry-run', '-y']);
      expect(result).toEqual({
        action: 'run',
        command: 'ping',
        isRemote: true,
        isDryRun: true,
        autoConfirm: true,
      });
    });
  });

  describe('computeNextSystemData (ステータス遷移計算)', () => {
    const baseData: SystemData = {
      status: 'NORMAL',
      last_active_at: '2026-01-01T00:00:00.000Z',
      warning_sent_at: null,
      dead_sent_at: null,
      push_subscriptions: [],
    };

    const mockConfig = { warningDays: 7, deadDays: 14 };

    it('ping コマンド実行時にステータスが NORMAL に更新され last_active_at が現在時刻になること', () => {
      const now = new Date('2026-08-07T12:00:00.000Z');
      const { updatedData, error } = computeNextSystemData('ping', baseData, now, mockConfig);

      expect(error).toBeUndefined();
      expect(updatedData.status).toBe('NORMAL');
      expect(updatedData.last_active_at).toBe(now.toISOString());
      expect(updatedData.warning_sent_at).toBeNull();
    });

    it('システムが DEAD の場合、ping 実行時にエラーを返すこと', () => {
      const deadData: SystemData = { ...baseData, status: 'DEAD' };
      const { error } = computeNextSystemData('ping', deadData, new Date(), mockConfig);

      expect(error).toBeDefined();
      expect(error?.message).toContain('DEAD');
    });

    it('warning コマンド実行時に last_active_at が (warningDays + 1) 日前に設定されること', () => {
      const now = new Date('2026-08-07T12:00:00.000Z');
      const { updatedData } = computeNextSystemData('warning', baseData, now, mockConfig);

      expect(updatedData.last_active_at).toBe(subDaysIso(8, now));
      expect(updatedData.status).toBe('NORMAL');
    });

    it('dead コマンド実行時に status が WARNING となり (deadDays + 1) 日前 / warningDays 日前に設定されること', () => {
      const now = new Date('2026-08-07T12:00:00.000Z');
      const { updatedData } = computeNextSystemData('dead', baseData, now, mockConfig);

      expect(updatedData.status).toBe('WARNING');
      expect(updatedData.last_active_at).toBe(subDaysIso(15, now));
      expect(updatedData.warning_sent_at).toBe(subDaysIso(7, now));
    });

    it('reset コマンド実行時にステータスが NORMAL にリセットされること', () => {
      const warningData: SystemData = {
        ...baseData,
        status: 'WARNING',
        warning_sent_at: '2026-08-01T00:00:00.000Z',
      };
      const now = new Date('2026-08-07T12:00:00.000Z');
      const { updatedData } = computeNextSystemData('reset', warningData, now, mockConfig);

      expect(updatedData.status).toBe('NORMAL');
      expect(updatedData.last_active_at).toBe(now.toISOString());
      expect(updatedData.warning_sent_at).toBeNull();
    });
  });

  describe('isMain 直接実行判定関数', () => {
    it('エントリーポイントと一致する場合に true を返すこと', () => {
      const filename = resolve('scripts/cli.ts');
      expect(isMain(filename, resolve('scripts/cli.ts'))).toBe(true);
      expect(isMain(filename, 'scripts/cli.ts')).toBe(true);
    });

    it('エントリーポイントと異なるファイルの場合に false を返すこと', () => {
      const filename = resolve('scripts/cli.ts');
      expect(isMain(filename, resolve('scripts/cli.test.ts'))).toBe(false);
      expect(isMain(filename, undefined)).toBe(false);
    });
  });

  describe('パッケージ定数とバージョン', () => {
    it('CLI_VERSION が正しく読み込まれていること', () => {
      expect(CLI_VERSION).toBe('1.0.0');
    });
  });

  describe('printUsage (STDERR 出力チェック)', () => {
    it('printUsage の案内メッセージが console.error（STDERR）に出力されること', () => {
      const spyError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      printUsage();
      expect(spyError).toHaveBeenCalledWith(expect.stringContaining("Dead Man's Switch CLI"));
      spyError.mockRestore();
    });
  });
});
